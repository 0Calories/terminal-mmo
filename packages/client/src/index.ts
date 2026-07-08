import {
	aabbOverlap,
	activeZone,
	applyImpulse,
	COMBAT,
	type Cosmetics,
	canStartDodge,
	capabilityUnlocked,
	clientStepAvatar,
	DEFAULT_WEAPON,
	type Entity,
	effectsOf,
	emoteById,
	entityBox,
	type Input,
	initialEmoteT,
	loadZones,
	PHYS,
	predictHits,
	randomCosmetics,
	SPAWN,
	spawnAvatar,
	stepAvatarCombat,
	WEAPONS,
	weaponById,
	type Zone,
} from '@mmo/shared';
import { createCliRenderer, type TerminalCapabilities } from '@opentui/core';
import { AudioOptions } from './audio-options-view';
import { CharacterCreator } from './character-creator';
import { parseChatCommand } from './chat';
import { ConfigStore } from './config';
import { Controls } from './controls';
import { Hud } from './hud';
import { InputState } from './input';
import { NetClient, snapshotToGame } from './net';
import { NoKittyNotice, NoticeGate, shouldWarnNoKitty } from './no-kitty';
import { PlayfieldRenderable } from './playfield';
import { resolveServerUrl } from './server-url';
import { Shop, type ShopView } from './shop';
import { SoundSystem } from './sound/system';
import {
	isMenuBlipKey,
	jumpStarted,
	landed,
	leveledUp,
} from './sound/triggers';
import { discoverSshIdentity } from './ssh-auth';
import { CLIENT_VERSION } from './version';

// The sim is dt-based, so this only affects smoothness + CPU, never game speed.
// Default 120 for high-refresh displays; override with MMO_FPS — e.g. MMO_FPS=60
// on a 60Hz panel, or over SSH where the refresh is unknowable (#22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// Connection resolution (ADR 0009 / 0012): resolveServerUrl picks the target — an
// explicit MMO_SERVER override (e.g. MMO_SERVER=ws://localhost:8080) wins, a
// from-source `dev` client defaults to the local dev server, and a published client
// defaults to the live World on Railway.
const SERVER = resolveServerUrl(process.env.MMO_SERVER, CLIENT_VERSION);

// No movement / combat this frame — fed to the sim while a modal (shop, chat)
// owns the keyboard, so held keys don't drive the Avatar.
const IDLE_INPUT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

const renderer = await createCliRenderer({
	targetFps: RENDER_FPS,
	exitOnCtrlC: true,
	backgroundColor: '#10121a',
	// Report RELEASE events for continuous held movement (M0 finding).
	useKittyKeyboard: { events: true },
});

// Control scheme (ADR 0017 §12): keyboard-only by default; MMO_SCHEME=mouse selects
// the keyboard+mouse scheme (left-click attack, skills on e/r). Both produce
// identical intents through the abstract action set, so the sim never sees the
// difference. The mouse scheme also binds the playfield's mouse buttons below.
const SCHEME = process.env.MMO_SCHEME === 'mouse' ? 'mouse' : 'keyboard';
const input = new InputState(SCHEME);
// The physical key bound to `interact` under the active scheme (ADR 0017 §12): `e`
// keyboard-only, `f` in the keyboard+mouse scheme (where `e` is a skill). Opens the
// Merchant when standing at one and closes it again (#267).
const INTERACT_KEY = SCHEME === 'mouse' ? 'f' : 'e';

// Equipped Weapon. There is no in-game equip UI yet, so MMO_WEAPON selects the demo
// weapon by NAME or by catalog index; an unknown value falls back to the default
// Warrior sword. The catalog is the one sword today (ADR 0024 — weapons differ only
// in damage + looks), but the seam stays: it drives BOTH the local prediction and
// the broadcast appearance, and rolled loot weapons will flow through it later.
function selectWeapon(): number {
	const raw = (process.env.MMO_WEAPON ?? '').trim();
	if (!raw) return DEFAULT_WEAPON;
	const byName = WEAPONS.findIndex(
		(w) => w.name.toLowerCase() === raw.toLowerCase(),
	);
	if (byName >= 0) return byName;
	const idx = Number(raw);
	return Number.isInteger(idx) && idx >= 0 && idx < WEAPONS.length
		? idx
		: DEFAULT_WEAPON;
}
const WEAPON = selectWeapon();
const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
// In the mouse scheme, route the playfield's left mouse button to the attack intent
// (OpenTUI fires these alongside held movement keys). A no-op in the keyboard scheme.
if (SCHEME === 'mouse') {
	playfield.onMouseDown = (e: { button: number }) => input.mouseDown(e.button);
	playfield.onMouseUp = (e: { button: number }) => input.mouseUp(e.button);
}
const hud = new Hud(renderer);
hud.attach(renderer.root);

// Non-Kitty input notice (#228, ADR 0024 §1–§4). Detection is PROACTIVE and fail-open:
// we read the terminal's resolved Kitty-keyboard capability, not the reactive
// releaseCapable flag. On a CONFIRMED no-Kitty terminal we raise a blocking, press-any-key
// overlay. It is re-evaluated fresh every launch (self-clears on a capable terminal) with no
// persistence and no opt-out — the keypress handlers below dismiss it on the first key.
//
// The Kitty-keyboard capability is NOT a null-until-resolved tri-state in OpenTUI: the native
// struct field is a plain boolean that DEFAULTS to false and only flips true once the async
// `ESC[?u` probe response is parsed (which fires a fresh `capabilities` event). So
// `renderer.capabilities` is already NON-null with `kitty_keyboard === false` the instant
// `createCliRenderer` resolves — reading it synchronously (or acting on the first, still-
// unresolved `capabilities` event) mistakes "not answered yet" for "confirmed absent" and
// wrongly warns on capable terminals like Ghostty. To honour ADR 0024 §2 ("warn only once
// RESOLVED") without a dedicated OpenTUI signal we: (a) treat a `kitty_keyboard === true` event
// as positive confirmation that cancels/retracts any warning, and (b) only warn once the probe
// response burst has gone quiet for the settle window with the flag still false. A terminal that
// answers nothing at all stays fail-open silent (ADR §2, the high-latency-SSH case).
const noKittyNotice = new NoKittyNotice(renderer);
noKittyNotice.attach(renderer.root);
// The notice is a STRICT sequential pre-gate (#301): while it is up it owns the screen and
// keyboard, and anything else that would appear at launch (the Avatar creator) is queued
// behind it via this gate rather than drawn under it. reconcile() runs whenever the notice
// opens or is dismissed so a late-resolving probe still holds — then releases — the queue.
const gate = new NoticeGate(noKittyNotice);
const KITTY_PROBE_SETTLE_MS = 500;
let kittyConfirmed = false;
let kittySettleTimer: ReturnType<typeof setTimeout> | null = null;
function warnNoKittyNow(): void {
	kittySettleTimer = null;
	if (kittyConfirmed || noKittyNotice.open) return;
	if (shouldWarnNoKitty(renderer.capabilities)) {
		noKittyNotice.show();
		gate.reconcile(); // hold anything already queued behind the freshly-raised notice
	}
}
function onKittyCapabilities(capabilities: TerminalCapabilities | null): void {
	if (capabilities?.kitty_keyboard === true) {
		// Confirmed capable — cancel a pending evaluation and retract a notice we may have
		// raised from an earlier, still-unresolved (false-default) reading; releasing the gate
		// so any UI queued behind the notice appears now.
		kittyConfirmed = true;
		if (kittySettleTimer) {
			clearTimeout(kittySettleTimer);
			kittySettleTimer = null;
		}
		if (noKittyNotice.open) {
			noKittyNotice.hide();
			gate.reconcile();
		}
		return;
	}
	// A still-false reading: (re)start the quiet timer. Each further probe response pushes it
	// back, so we evaluate only after the burst settles — then warn if it is still false.
	if (kittyConfirmed) return;
	if (kittySettleTimer) clearTimeout(kittySettleTimer);
	kittySettleTimer = setTimeout(warnNoKittyNow, KITTY_PROBE_SETTLE_MS);
}
// Dismiss the notice on the first key and release the gate so the queued UI appears now.
function dismissNoKittyNotice(): void {
	noKittyNotice.hide();
	gate.reconcile();
}
renderer.on('capabilities', (capabilities: TerminalCapabilities) =>
	onKittyCapabilities(capabilities),
);
// If the probe somehow already resolved before this listener attached, act on a POSITIVE only —
// never treat the synchronous, pre-probe default of `false` as authoritative (that is the bug
// this replaces). A false/undefined here just waits for the `capabilities` events above.
if (renderer.capabilities?.kitty_keyboard === true) kittyConfirmed = true;

// Best-effort, always-optional audio (ADR 0014). Init is attempted once here,
// gated inside the facade on an interactive TTY, so a headless/piped launch
// never touches the engine; every play() is a no-op when disabled.
const sound = new SoundSystem({ debug: process.env.MMO_DEBUG === '1' });
// The playfield voices per-tick combat Effects (hit/death) as spatialized world
// SoundEffects from the same render path it spawns particles on (ADR 0014).
playfield.sound = sound;

// Persisted audio prefs (ADR 0015): the client's first on-disk config. Load it,
// apply the saved mixer state (so a player who muted stays muted), then write any
// later change back through onChange. Tolerant by construction — a missing/corrupt
// file falls back to defaults and a failed write degrades to in-memory, never a crash.
const config = new ConfigStore().load();
sound.applyAudioPrefs(config.audio());
sound.onChange = () => config.saveAudio(sound.audioPrefs());
// If sustained engine errors force audio off mid-session (#268), remember it and
// surface a one-line warning on exit — printed after teardown (below) so it lands on
// the normal screen, never corrupting the live TUI.
let audioDegraded = false;
sound.onDegraded = () => {
	audioDegraded = true;
};

// A one-line Identity Key notice to surface on exit (#297): the generated-key notice
// ("kept your identity at …") or the ephemeral-fallback warning ("progress won't be
// saved"). Printed after teardown like the audio warning so it lands on the normal
// screen, never corrupting the live TUI (the discovery resolves after renderer.start).
let identityNotice: string | null = null;

function quit(message?: string) {
	sound.dispose(); // tear the engine down without blocking exit
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	// Printed after the TUI is torn down so it lands on the normal screen, not the
	// cleared alt-screen (e.g. a server rejection reason, ADR 0009).
	if (audioDegraded)
		console.error('audio disabled after repeated engine errors this session');
	if (identityNotice) console.error(identityNotice);
	if (message) console.error(message);
	process.exit(message ? 1 : 0);
}

// `?` (shift+/) opens the controls overlay (#242). Terminals differ on whether they
// name the key `?` or report it only as the sequence, so both are accepted.
function isHelpKey(k: { name: string; sequence?: string }): boolean {
	return k.name === '?' || k.sequence === '?';
}

// A running FPS estimate for the render loop.
function fpsMeter() {
	let fps = 0;
	let acc = 0;
	let frames = 0;
	return (dt: number) => {
		acc += dt;
		frames++;
		if (acc >= 500) {
			fps = Math.round((frames * 1000) / acc);
			acc = 0;
			frames = 0;
		}
		return fps;
	};
}

// --- Networked (M2) ---------------------------------------------------------

// The static content (terrain / portals / NPCs) for a Zone id, loaded once from the
// authored `.zone` files (ADR 0008). The server is authoritative over entities; the
// client only needs the local geometry to predict its own Avatar and draw the
// playfield. Falls back to the start Zone for an unknown id.
const LOCAL_ZONES = new Map<string, Zone>(loadZones().map((z) => [z.id, z]));
function localZone(id: string): Zone {
	return LOCAL_ZONES.get(id) ?? LOCAL_ZONES.get('field-01') ?? loadZones()[0];
}

async function runNetworked(url: string) {
	// The desired Handle for a first launch (ADR 0004, #235): MMO_HANDLE wins
	// verbatim (the server validates it), otherwise $USER squeezed into the allowed
	// shape — falling back to 'wanderer' when even that leaves it too short. A
	// returning key ignores this — its registered Handle is durable.
	const fromUser = (process.env.USER || '')
		.replace(/[^A-Za-z0-9_-]/g, '-')
		.slice(0, 16);
	const handle =
		process.env.MMO_HANDLE || (fromUser.length >= 2 ? fromUser : 'wanderer');
	// The Identity Key that will answer the server's challenge (ADR 0004, #235,
	// amendment #297): the anchored key, a real external SSH key, or a generated
	// fallback so a keyless launch is never locked out. Resolved before any UI shows.
	// Sharing the existing `config` keeps the anchor write in the same in-memory config
	// a later audio save persists, so it can't be clobbered. The only refusal left is an
	// anchored external key that's temporarily unreachable (recoverable, non-destructive).
	const resolved = await discoverSshIdentity(config);
	if (!resolved.ok) {
		quit(resolved.refusal);
		return;
	}
	const identity = resolved.identity; // narrowed const, so the play() closure sees it
	identityNotice = resolved.notice ?? null; // surfaced on exit (generated / ephemeral)
	// Pre-spawn customization (#36, story 7): the Player picks hue / hat / nameplate
	// and confirms BEFORE we connect, so the chosen look rides the connect handshake
	// (#35) and everyone sees it the moment they spawn in. Seeded with a randomized
	// starting look so a Player who just hits Enter still gets a distinct Avatar.
	const creator = new CharacterCreator(
		renderer,
		handle,
		randomCosmetics((Math.random() * 0x7fffffff) | 0),
	);
	creator.attach(renderer.root);
	// Queue the creator strictly behind the notice (#301): the gate shows it now if the
	// notice isn't up, or holds it hidden and un-interactive until the notice is
	// dismissed — so the creator never paints over or steals input from the notice.
	gate.request(creator);

	// Phase 1 — the picker owns the keyboard: every key drives a selection and, on
	// Enter, hands back the chosen Cosmetics. `started` makes this handler inert once
	// play() has taken over the keys (its own listener is added then), so the two
	// phases never both react to a key.
	let started = false;
	renderer.keyInput.on('keypress', (k) => {
		if (started) return;
		// The blocking no-Kitty notice owns the keyboard while up: the first key press
		// dismisses it and is swallowed so it doesn't also drive customization (#228,
		// #301). Dismissal releases the gate, which then reveals the queued creator.
		if (noKittyNotice.open) {
			dismissNoKittyNotice();
			return;
		}
		if (k.name === 'q') quit();
		// UI blip on customize navigation / confirm (ADR 0014), the same menu click
		// the shop uses — a centered, full-volume interface tick.
		if (isMenuBlipKey(k.name)) sound.play('ui');
		const chosen = creator.key(k.name);
		if (!chosen) return;
		started = true;
		gate.release(creator); // done with the gate; hide the creator and hand off to play
		play(chosen);
	});

	// Phase 2 — connect with the confirmed look and run the live World loop.
	function play(cosmetics: Cosmetics) {
		// On a server refusal (protocol mismatch / connection cap, ADR 0009), tear down
		// the TUI and print the reason so it isn't buried under the alt-screen.
		const net = new NetClient(
			url,
			handle,
			identity,
			(reason) => {
				quit(reason);
			},
			cosmetics,
			WEAPON,
		);
		hud.showAlphaNotice(); // ephemeral live World (ADR 0009)
		// The Zone we currently render + predict against; swapped when the server moves
		// us between Zones (portal travel, death respawn).
		let zoneId = 'field-01';
		let zone = localZone(zoneId);

		// Own Avatar, predicted locally for zero input lag; the server corrects vitals
		// (and snaps position on respawn) via snapshots. Seeded with the chosen Weapon so
		// the local swing predicts with its stat block and renders it before the first
		// snapshot echoes it back (ADR 0017 §14).
		let predicted: Entity = {
			...spawnAvatar(SPAWN.x, SPAWN.y),
			weapon: WEAPON,
		};
		const SEND_INTERVAL = 1000 / 30; // throttle input reports to ~30 Hz
		let sendAcc = 0;
		// Audio options modal (ADR 0014/0015): a global overlay opened with `o` during play.
		const options = new AudioOptions(renderer, sound);
		options.attach(renderer.root);
		// Controls cheat-sheet (#242): a read-only overlay toggled with `?`, gating verbs
		// against the live server-authoritative level.
		const controls = new Controls(renderer);
		controls.attach(renderer.root);
		// Server-authoritative Merchant (#267/#273, ADR 0025): a full Sell + Buy overlay.
		// Gold + inventory are read straight off the snapshot (the server owns the bag); a
		// confirmed sell/buy issues a validated `sell`/`buy` intent and the NEXT snapshot
		// reflects the change — no optimistic local mutation, so the client can never drift
		// from the server's Gold.
		const shop = new Shop(renderer);
		shop.attach(renderer.root);
		// The Gold + inventory the Merchant renders, sourced from the latest snapshot. Empty
		// until the first snapshot arrives.
		const shopView = (): ShopView => ({
			inventory: net.latest?.inventory ?? [],
			progress: net.latest?.progress ?? { level: 1, xp: 0, gold: 0 },
		});
		// A Merchant (vendor NPC) overlapping the predicted Avatar in the current Zone — the
		// client-side gate to OPEN the overlay. The server re-checks this proximity
		// authoritatively on every sell, so a client can't trade from afar (#267).
		const merchantUnder = (): boolean => {
			const box = entityBox(predicted);
			return (zone.npcs ?? []).some(
				(n) => n.kind === 'vendor' && aabbOverlap(box, n),
			);
		};
		// Issue a validated sell of the selected Item. Sends only the id — the server
		// re-derives the price and re-checks ownership + proximity. No local Gold/inventory
		// edit: the authoritative bag arrives on the next snapshot.
		const sellSelected = (): void => {
			const inv = shopView().inventory;
			const item = inv[shop.selected];
			if (!item) return;
			net.send({ t: 'sell', itemId: item.id });
			shop.move(0, Math.max(0, inv.length - 1)); // clamp the cursor optimistically
		};
		// Issue a validated buy of the selected starter good. Sends only its catalog index —
		// the server re-derives the price, re-checks affordability + proximity, and mints the
		// Item. No local Gold/inventory edit: the authoritative bag arrives on the next
		// snapshot (#273).
		const buySelected = (): void => {
			net.send({ t: 'buy', index: shop.selected });
		};
		const handleShopKey = (name: string): void => {
			// UI blip on menu navigation / confirm (ADR 0014); close (interact/esc) is silent.
			if (isMenuBlipKey(name)) sound.play('ui');
			const count = shop.count(shopView());
			switch (name) {
				case 'left':
				case 'right':
					shop.switchTab();
					break;
				case 'up':
					shop.move(-1, count);
					break;
				case 'down':
					shop.move(1, count);
					break;
				case 'return':
					if (shop.mode === 'buy') buySelected();
					else sellSelected();
					break;
				case INTERACT_KEY:
				case 'escape':
					shop.hide();
					break;
			}
			if (shop.open) shop.update(shopView());
		};

		// A submitted chat line (Enter in the InputRenderable, #272): classify it and relay
		// it, then leave typing mode. A Zone-local say or a `/w` whisper goes to the wire; an
		// emote triggers server-side AND predicts locally for zero lag; a bad command surfaces
		// a local usage notice (no round-trip); an empty line just closes.
		const submitChat = (text: string): void => {
			const line = text.trim();
			if (line) {
				const cmd = parseChatCommand(line);
				if (cmd.kind === 'say') net.send({ t: 'chat', text: cmd.text });
				else if (cmd.kind === 'whisper')
					net.send({ t: 'whisper', to: cmd.to, text: cmd.text });
				else if (cmd.kind === 'emote') {
					// Arm the predicted Avatar now (a oneshot seeds its countdown, a loop/hold its
					// elapsed clock at 0); clientStepAvatar advances it and cancels it on
					// movement/combat, mirroring the server (ADR 0020 §9).
					net.send({ t: 'emote', emote: cmd.emote });
					const def = emoteById(cmd.emote);
					if (def)
						predicted = {
							...predicted,
							emoteId: def.id,
							emoteT: initialEmoteT(def),
						};
				} else net.notice(cmd.message);
			}
			hud.closeChat();
		};
		hud.enableChat(submitChat);

		renderer.keyInput.on('keypress', (k) => {
			// The blocking no-Kitty notice owns the keyboard first (it can resolve a beat
			// into play on a slow probe): the first key dismisses it and is swallowed so it
			// can't also drive movement / combat (#228, #301).
			if (noKittyNotice.open) {
				dismissNoKittyNotice();
				return;
			}
			// While typing, chat OWNS the keyboard: the focused InputRenderable edits the
			// line itself (it subscribes to keys on focus) and submits on Enter via
			// submitChat; here Escape closes and every other key is swallowed so none
			// reaches movement / combat (no keystroke leak, #272).
			if (hud.chatOpen) {
				if (k.name === 'escape') hud.closeChat();
				return;
			}
			if (k.name === 'q') quit();
			// The options modal owns the keyboard while open (after the chat block, so
			// typing still wins): arrows/m adjust the mixer (persisted live), o/esc close.
			if (options.open) {
				options.key(k.name);
				return;
			}
			// The controls overlay owns the keyboard while open: `?`/esc close, every
			// other key is swallowed so it can't drive the Avatar.
			if (controls.open) {
				if (isHelpKey(k) || k.name === 'escape') controls.hide();
				return;
			}
			// `m` toggles master mute instantly (ADR 0014). Placed after the chat block
			// so it edits the line while typing and only mutes during play.
			if (k.name === 'm') {
				sound.toggleMute();
				return;
			}
			// The Merchant overlay owns the keyboard while open (#267/#273): tab / navigate /
			// sell / buy / close, and swallow every key so none reaches the sim.
			if (shop.open) {
				handleShopKey(k.name);
				return;
			}
			if (isHelpKey(k)) {
				controls.show(net.latest?.progress.level ?? 1, SCHEME);
				return;
			}
			if (k.name === 'o') {
				options.show();
				return;
			}
			if (k.name === 'return') {
				// Open chat and CONSUME this Enter (preventDefault) so it isn't also delivered
				// to the input we just focused — the focused InputRenderable subscribes to keys
				// during this same dispatch, so an un-consumed Enter would submit an empty line
				// and snap chat shut again (#272).
				k.preventDefault();
				hud.openChat();
				input.clear(); // a key held at the switch must not stick while typing
				return;
			}
			// Open the Merchant when standing at one (#267): swallow the interact key so it
			// isn't also fed to the sim as a Portal intent, and clear held movement so a key
			// down at the switch can't stick while the overlay owns the keyboard.
			if (k.name === INTERACT_KEY && merchantUnder()) {
				input.clear();
				shop.show();
				shop.update(shopView());
				return;
			}
			input.press(k.name, performance.now());
		});
		// Ignore releases while typing so play-mode keys can't be toggled mid-message.
		renderer.keyInput.on('keyrelease', (k) => {
			if (!hud.chatOpen) input.release(k.name);
		});

		const meter = fpsMeter();
		// Level-up flourish: seeded from the first real snapshot (null until then) so a
		// reconnect at an already-high level can't false-trigger; thereafter it fires
		// once on each rising edge of the server-authoritative level.
		let prevLevel: number | null = null;
		renderer.setFrameCallback(async (dt) => {
			// Freeze movement / combat while a modal (chat line, controls, Merchant,
			// audio options) has the keyboard; the same gate suppresses the interact
			// edge on send so a menu can't fire a Portal from under itself.
			const modalActive =
				hud.chatOpen ||
				controls.open ||
				shop.open ||
				options.open ||
				noKittyNotice.open;
			const inp = modalActive ? IDLE_INPUT : input.poll(performance.now());

			// Follow a server-driven Zone change (portal travel / death respawn): swap the
			// local Zone and snap the predicted Avatar to the server's arrival position so
			// it doesn't briefly run in the old Zone before reconciling.
			if (net.zoneId && net.zoneId !== zoneId) {
				zoneId = net.zoneId;
				zone = localZone(zoneId);
				const arrival = net.ownAvatar();
				if (arrival)
					predicted = {
						...predicted,
						x: arrival.x,
						y: arrival.y,
						vx: 0,
						vy: 0,
						onGround: false,
					};
			}

			// A Dodge hop (ADR 0017 §5) is a momentum-body impulse applied BEFORE physics
			// so clientStepAvatar integrates it this frame; gated by the same
			// full Dodge gate (grounded + held direction + off cooldown), evaluated HERE
			// before the hop's upward pop ungrounds the body; the gated decision drives the
			// impulse, the i-frame timer (stepAvatarCombat below), and the report to the server,
			// so all three agree on whether the hop fired. Direction is `inp.moveX`.
			const dodging =
				(inp.dodge ?? false) &&
				canStartDodge(predicted, inp.moveX) &&
				capabilityUnlocked('dodge', net.latest?.progress.level ?? 1);
			if (dodging) {
				predicted = applyImpulse(
					predicted,
					inp.moveX * COMBAT.dodge.impulse,
					-COMBAT.dodge.up,
				);
			}

			const prevOnGround = predicted.onGround;
			predicted = clientStepAvatar(
				zone.terrain,
				predicted,
				{ moveX: inp.moveX, jump: inp.jump },
				dt,
			);
			// Self SoundEffects on our own predicted Avatar (client-local, centered,
			// full volume): the jump blip on take-off, the footfall on touchdown.
			if (jumpStarted({ onGround: prevOnGround }, predicted))
				sound.play('jump');
			if (landed({ onGround: prevOnGround }, predicted)) sound.play('land');
			// Optimistic local telegraph (story 17): mirror the server's cooldown gate
			// so the swing/skill flash shows before the snapshot confirms the hit. The
			// same gate yields the outgoing hitbox + damage for blood prediction (ADR
			// 0013): a fired Skill overrides the basic swing, matching resolveAvatarIntent.
			const dtSec = Math.min(dt / 1000, PHYS.maxDt);
			// Optimistic combat fold through the EXACT shared per-Avatar function the
			// server runs (ADR 0022 slice 1): it folds the swing/skill `attackT`, the
			// i-frame Dodge timers, the held-Guard timer, and the per-swing `swingHits`
			// reset onto our own Avatar, and returns the outgoing hitbox + damage for the
			// blood prediction below (ADR 0013). Because both sides call one function, the
			// local telegraph/Guard/Dodge can no longer diverge from the authoritative
			// outcome. Reconciliation of the negated/landed result stays server-owned (HP +
			// the snapshot's blood Effects). A fired Skill overrides the basic swing.
			const fold = stepAvatarCombat(
				predicted,
				{
					attack: inp.attack,
					skill: inp.skill,
					dodge: dodging,
					guard: inp.guard,
				},
				{
					level: net.latest?.progress.level ?? 1,
					cls: 'warrior',
					weapon: weaponById(predicted.weapon),
					dt: dtSec,
				},
			);
			// The fold now returns `{ avatar, strikes }` (ADR 0022): skill cooldowns ride the
			// predicted avatar (`predicted.skillCooldowns`), and the outgoing swing/skill box
			// for the blood prediction below is the projected player Strike (0 or 1 this tick).
			predicted = fold.avatar;
			const strike = fold.strikes[0];
			const hitbox = strike?.hitbox ?? null;
			const hitDamage = strike?.damage ?? 0;

			// Server owns vitals; reconcile HP/i-frames from snapshots. Position is NOT
			// reconciled here: per ADR 0001 the client is authoritative over its own
			// position and the server never re-simulates it, so the snapshot only echoes
			// back our own position from ~one round-trip ago. Snapping to it would drag
			// the Avatar backward on every moving frame once RTT is non-trivial (#68).
			// Server-initiated teleports (respawn, portal) arrive as a Zone change and are
			// handled by the net.zoneId branch above.
			const own = net.ownAvatar();
			if (own) {
				predicted.hp = own.hp;
				predicted.maxHp = own.maxHp;
				predicted.hurtT = own.hurtT;
			}

			sendAcc += dt;
			if (sendAcc >= SEND_INTERVAL) {
				sendAcc = 0;
				// Read the latched interact edge exactly once per send (never per poll,
				// which runs far faster) so a single press reaches the wire once. During a
				// modal we still drain it — but report false — so it clears instead of
				// firing a Portal the instant the menu closes.
				const interact = input.consumeInteract();
				net.send({
					t: 'input',
					x: predicted.x,
					y: predicted.y,
					vx: predicted.vx,
					vy: predicted.vy,
					facing: predicted.facing,
					onGround: predicted.onGround,
					attack: inp.attack,
					guard: inp.guard ?? false,
					interact: modalActive ? false : interact,
					// the gated decision, so the server starts the i-frame timer iff the hop
					// fired client-side (grounded + moving), not on every key-press (ADR 0017 §5).
					dodge: dodging,
					skill: inp.skill,
				});
			}

			const fps = meter(dt);
			// Co-present entities are rendered from the buffer, interpolated ~100 ms in
			// the past for smooth motion between ticks; the own Avatar stays purely
			// predicted (only its vitals reconcile against net.latest, never the delayed
			// view), so local motion is never dragged backward by network latency.
			const view = net.sample(performance.now());
			// Age over-head Speech bubbles by wall time, then stamp the live ones onto
			// their senders' entities for the playfield to draw (#59, ADR 0007).
			net.decayBubbles(dt / 1000);
			const game = snapshotToGame(
				zone,
				predicted,
				net.sessionId,
				view,
				// Predicted skill cooldowns now live on the avatar (ADR 0022 slice 2).
				predicted.skillCooldowns ?? {},
				net.bubbles,
			);
			playfield.game = game;
			// Level-up flourish off the server-authoritative progression in the snapshot:
			// the sound, a gold particle burst at the Avatar (spawned off the just-set
			// playfield state so it lands on the fresh position), and the HUD banner (#271).
			// The unlock log lines ride the snapshot's `player.log`, surfaced by the HUD.
			const snapLevel = net.latest?.progress.level;
			if (snapLevel != null) {
				if (prevLevel != null && leveledUp(prevLevel, snapLevel)) {
					sound.play('level-up');
					playfield.levelUpBurst();
					hud.flashLevelUp();
				}
				prevLevel = snapLevel;
			}
			// Predict our own outgoing-hit blood off the rendered (interpolated)
			// Monsters, so it erupts instantly; the server suppresses the matching
			// Effect back to us, so there is no double-render (ADR 0013). Resolve the
			// optimistic `hit` CombatEvents through the SAME shared swing-hit gate the
			// server uses — deduped by `predicted.swingHits`, not the old inert hurtT
			// check — then project them to Effects via `effectsOf` (ADR 0019). A
			// mispredicted swing leaves a harmless stray splat — no rollback.
			if (hitbox) {
				const monsters = activeZone(game.world, game.player.zoneId).monsters;
				const swung = new Set(predicted.swingHits ?? []);
				const events = predictHits(
					hitbox,
					predicted.facing,
					hitDamage,
					swung,
					monsters,
				);
				for (const e of events) swung.add(e.targetId);
				predicted.swingHits = [...swung];
				playfield.emitPredicted(events.flatMap(effectsOf));
			}
			hud.update(game, fps);
			hud.syncChat(net.chatLog);
			// Re-render the Merchant from the freshest snapshot so a completed sell (Item gone,
			// Gold up) or buy (Item in, Gold down) shows the moment the server confirms it
			// (#267/#273).
			if (shop.open) shop.update(shopView());
		});
	}
}

// Start last, after every module-level declaration: runNetworked reads the
// `LOCAL_ZONES` const (above), so invoking it earlier would hit that const's
// temporal dead zone (the function itself is hoisted and callable here).
runNetworked(SERVER);

renderer.start();
