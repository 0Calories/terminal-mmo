import {
	aabbOverlap,
	activeZone,
	applyImpulse,
	COMBAT,
	canStartDodge,
	capabilityUnlocked,
	clientStepAvatar,
	DEFAULT_COSMETICS,
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

// dt-based sim, so this only affects smoothness + CPU, never game speed. Override with
// MMO_FPS on a non-120Hz panel, or over SSH where the refresh is unknowable (#22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// MMO_SERVER override wins; else a dev client uses the local server, a published one
// the live World (ADR 0009 / 0012).
const SERVER = resolveServerUrl(process.env.MMO_SERVER, CLIENT_VERSION);

// Fed to the sim while a modal owns the keyboard, so held keys don't drive the Avatar.
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

// MMO_SCHEME=mouse selects the keyboard+mouse scheme; both produce identical intents
// so the sim never sees the difference (ADR 0017 §12).
const SCHEME = process.env.MMO_SCHEME === 'mouse' ? 'mouse' : 'keyboard';
const input = new InputState(SCHEME);
// `f` in the mouse scheme, where `e` is a skill instead (ADR 0017 §12, #267).
const INTERACT_KEY = SCHEME === 'mouse' ? 'f' : 'e';

// No in-game equip UI yet, so MMO_WEAPON picks the demo weapon by name or catalog
// index; unknown falls back to the default sword (ADR 0024).
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
// Route the playfield's mouse buttons to attack intents in the mouse scheme.
if (SCHEME === 'mouse') {
	playfield.onMouseDown = (e: { button: number }) => input.mouseDown(e.button);
	playfield.onMouseUp = (e: { button: number }) => input.mouseUp(e.button);
}
const hud = new Hud(renderer);
hud.attach(renderer.root);

// Non-Kitty input notice (#228, ADR 0024): a blocking press-any-key overlay on a
// confirmed no-Kitty terminal, fail-open and re-evaluated fresh each launch.
//
// The gotcha: OpenTUI's `kitty_keyboard` is a false-DEFAULTING boolean, not a
// null-until-resolved tri-state — it flips true only once the async `ESC[?u` probe
// response is parsed. So a synchronous read mistakes "not answered yet" for "confirmed
// absent" and wrongly warns on capable terminals like Ghostty. So: treat a `true` event
// as confirmation that retracts any warning, and only warn once the probe burst has gone
// quiet for the settle window with the flag still false (a silent terminal stays
// fail-open — the high-latency-SSH case).
const noKittyNotice = new NoKittyNotice(renderer);
noKittyNotice.attach(renderer.root);
// A strict sequential pre-gate (#301): while the notice is up it owns the screen, and
// launch UI (the creator) is queued behind it rather than drawn under it. reconcile()
// runs on open/dismiss so a late-resolving probe still holds then releases the queue.
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
		// Confirmed capable: cancel a pending evaluation and retract any notice raised
		// from an earlier false-default reading, releasing the gate.
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
	// Still-false reading: (re)start the quiet timer, so each further probe pushes it back
	// and we evaluate only after the burst settles.
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
// If the probe already resolved before this listener attached, act on a POSITIVE only —
// never treat the pre-probe default `false` as authoritative; it just waits for the events.
if (renderer.capabilities?.kitty_keyboard === true) kittyConfirmed = true;

// Best-effort optional audio (ADR 0014): init is gated inside the facade on an
// interactive TTY, so a headless/piped launch never touches the engine.
const sound = new SoundSystem({ debug: process.env.MMO_DEBUG === '1' });
// The playfield voices combat Effects from the same render path it spawns particles on.
playfield.sound = sound;

// Persisted audio prefs (ADR 0015): apply saved mixer state, write later changes back
// through onChange. A missing/corrupt file falls back to defaults, a failed write to
// in-memory — never a crash.
const config = new ConfigStore().load();
sound.applyAudioPrefs(config.audio());
sound.onChange = () => config.saveAudio(sound.audioPrefs());
// If engine errors force audio off mid-session (#268), warn on exit — printed after
// teardown so it lands on the normal screen, not the live TUI.
let audioDegraded = false;
sound.onDegraded = () => {
	audioDegraded = true;
};

// An Identity Key notice to surface on exit (#297): generated-key or ephemeral-fallback
// warning. Printed after teardown like the audio warning so it lands on the normal screen.
let identityNotice: string | null = null;

function quit(message?: string) {
	sound.dispose(); // tear the engine down without blocking exit
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	// Printed after teardown so it lands on the normal screen, not the cleared
	// alt-screen (e.g. a server rejection reason, ADR 0009).
	if (audioDegraded)
		console.error('audio disabled after repeated engine errors this session');
	if (identityNotice) console.error(identityNotice);
	if (message) console.error(message);
	process.exit(message ? 1 : 0);
}

// Terminals differ on whether they name the key `?` or only report the sequence, so
// both are accepted (#242).
function isHelpKey(k: { name: string; sequence?: string }): boolean {
	return k.name === '?' || k.sequence === '?';
}

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

// Static Zone content (terrain/portals/NPCs) from the authored `.zone` files: the
// client needs only local geometry to predict its Avatar; the server owns entities
// (ADR 0008). Falls back to the start Zone for an unknown id.
const LOCAL_ZONES = new Map<string, Zone>(loadZones().map((z) => [z.id, z]));
function localZone(id: string): Zone {
	return LOCAL_ZONES.get(id) ?? LOCAL_ZONES.get('field-01') ?? loadZones()[0];
}

async function runNetworked(url: string) {
	// The desired Handle for a first launch (ADR 0004, #235): MMO_HANDLE verbatim, else
	// $USER squeezed into the allowed shape, else 'wanderer'. A returning key ignores
	// this — its registered Handle is durable.
	const fromUser = (process.env.USER || '')
		.replace(/[^A-Za-z0-9_-]/g, '-')
		.slice(0, 16);
	const handle =
		process.env.MMO_HANDLE || (fromUser.length >= 2 ? fromUser : 'wanderer');
	// The Identity Key that answers the server's challenge (ADR 0004, #235, #297): anchored
	// key, external SSH key, or generated fallback so a keyless launch is never locked out.
	// Sharing the existing `config` keeps the anchor write in the same in-memory config a
	// later audio save persists, so it can't be clobbered.
	const resolved = await discoverSshIdentity(config);
	if (!resolved.ok) {
		quit(resolved.refusal);
		return;
	}
	const identity = resolved.identity; // narrowed const, so the play() closure sees it
	identityNotice = resolved.notice ?? null; // surfaced on exit (generated / ephemeral)
	// Server-gated Avatar creation (#302, ADR 0028): connect FIRST, then the server's
	// `welcome` decides new-vs-returning from its Save lookup, never a client flag. A new
	// account is held authenticated-but-unspawned behind the creator (no snapshot arrives
	// until `createAvatar`); a returning one drops straight into its last Town.
	const creator = new CharacterCreator(
		renderer,
		handle,
		randomCosmetics((Math.random() * 0x7fffffff) | 0),
	);

	let started = false; // the live World loop is running (we are spawned)
	let creating = false; // the creator is up (a new account finalising its look)

	// On a server refusal (protocol mismatch / connection cap, ADR 0009), tear down and
	// print the reason so it isn't buried under the alt-screen.
	const net = new NetClient(
		url,
		handle,
		identity,
		(reason) => {
			quit(reason);
		},
		DEFAULT_COSMETICS,
		WEAPON,
		(isNew) => {
			if (isNew) {
				creating = true;
				creator.attach(renderer.root);
				// Queue the creator behind the no-Kitty notice (#301): shown now if the notice
				// isn't up, else held hidden until it's dismissed.
				gate.request(creator);
			} else {
				play();
			}
		},
	);

	// A rejected Handle (#304): the server refused the claim but kept the session — surface
	// the reason inline so the Player retries.
	net.onCreateRejected = (reason) => {
		creator.showRejection(reason);
	};
	// The server spawned us (first snapshot): a new account leaves the creator. Idempotent —
	// a returning account already started the loop on `welcome`.
	net.onSpawned = () => {
		if (creating) {
			creating = false;
			// #301: done with the gate — hide the creator, stop it ever re-showing.
			gate.release(creator);
		}
		play();
	};

	// The creator is up (new account only): this global handler runs BEFORE the creator's focused
	// name input, so `creator.key` gets first crack — it moves ladder focus on ↑/↓ and confirms on
	// Enter (swallowing both), leaving typing for the focused name field. A valid Enter sends
	// `createAvatar`. Inert once spawned (`started`) or before it opens.
	renderer.keyInput.on('keypress', (k) => {
		if (started) return;
		// The no-Kitty notice owns the keyboard while up: the first key dismisses it and is
		// swallowed so it doesn't also drive customization (#228, #301).
		if (noKittyNotice.open) {
			dismissNoKittyNotice();
			return;
		}
		if (!creating) {
			// Still connecting / holding — nothing to customize yet; q quits.
			if (k.name === 'q') quit();
			return;
		}
		// UI blip on menu keys only — typing the name is silent (ADR 0014). 'q' types into the
		// focused name field instead of quitting, so names can contain it.
		if (isMenuBlipKey(k.name)) sound.play('ui');
		const result = creator.key(k);
		if (!result) return;
		// A valid Handle confirmed: freeze the creator and finalise. The World starts only when
		// the spawn snapshot arrives (onSpawned); the creator stays frozen through the round-trip
		// rather than hidden the instant Enter is pressed.
		creator.setBusy(true);
		net.send({
			t: 'createAvatar',
			handle: result.handle,
			cosmetics: result.cosmetics,
		});
	});

	// Run the live World loop once the server has spawned us. Idempotent guard so the two
	// entry paths (returning on `welcome`, new after `createAvatar`) can't double-start it.
	function play() {
		if (started) return;
		started = true;
		hud.showAlphaNotice(); // ephemeral live World (ADR 0009)
		// The Zone we render + predict against; swapped when the server moves us (portal,
		// death respawn).
		let zoneId = 'field-01';
		let zone = localZone(zoneId);

		// Own Avatar, predicted locally for zero input lag; the server corrects vitals via
		// snapshots. Seeded with the chosen Weapon so the swing predicts with its stat block
		// before the first snapshot echoes it back (ADR 0017 §14).
		let predicted: Entity = {
			...spawnAvatar(SPAWN.x, SPAWN.y),
			weapon: WEAPON,
		};
		const SEND_INTERVAL = 1000 / 30; // throttle input reports to ~30 Hz
		let sendAcc = 0;
		// Audio options modal (ADR 0014/0015): a global overlay opened with `o` during play.
		const options = new AudioOptions(renderer, sound);
		options.attach(renderer.root);
		// Controls cheat-sheet (#242): a read-only overlay toggled with `?`.
		const controls = new Controls(renderer);
		controls.attach(renderer.root);
		// Server-authoritative Merchant (#267/#273, ADR 0025): Gold + inventory read off the
		// snapshot; a confirmed sell/buy issues a validated intent and the NEXT snapshot reflects
		// it — no optimistic local mutation, so the client can't drift from the server's Gold.
		const shop = new Shop(renderer);
		shop.attach(renderer.root);
		// In-game re-customization (#305, ADR 0028): `[c]` in Town reopens the creator in
		// cosmetics-only mode. Lazily built, reused across presses — each open re-seeds to the
		// Avatar's CURRENT look off the snapshot.
		let recustomize: CharacterCreator | null = null;
		const openRecustomize = (): void => {
			const own = net.ownAvatar();
			const cos = own?.cosmetics ?? DEFAULT_COSMETICS;
			if (!recustomize) {
				// Seed the read-only Handle from the snapshot's own Avatar, NOT `net.handle`: for an
				// account created THIS session the latter still holds the pre-claim handshake name, so
				// it would misdisplay a Player-typed Handle until reconnect. Set-once, so caching on
				// first open is correct.
				const durableHandle = own?.handle ?? net.handle;
				recustomize = new CharacterCreator(renderer, durableHandle, cos, false);
				recustomize.attach(renderer.root);
			} else {
				recustomize.reopen(cos);
			}
			input.clear(); // drop held movement so a key at the switch can't stick under the modal
			recustomize.show();
		};
		// Gold + inventory the Merchant renders, off the latest snapshot.
		const shopView = (): ShopView => ({
			inventory: net.latest?.inventory ?? [],
			progress: net.latest?.progress ?? { level: 1, xp: 0, gold: 0 },
		});
		// A vendor NPC overlapping the predicted Avatar: the client-side gate to OPEN the
		// overlay. The server re-checks proximity on every sell, so no trading from afar (#267).
		const merchantUnder = (): boolean => {
			const box = entityBox(predicted);
			return (zone.npcs ?? []).some(
				(n) => n.kind === 'vendor' && aabbOverlap(box, n),
			);
		};
		// Sends only the id — the server re-derives the price and re-checks ownership + proximity.
		// No local edit: the authoritative bag arrives next snapshot.
		const sellSelected = (): void => {
			const inv = shopView().inventory;
			const item = inv[shop.selected];
			if (!item) return;
			net.send({ t: 'sell', itemId: item.id });
			shop.move(0, Math.max(0, inv.length - 1)); // clamp the cursor optimistically
		};
		// Sends only the catalog index — the server re-derives price, re-checks affordability +
		// proximity, mints the Item. No local edit: the bag arrives next snapshot (#273).
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

		// A submitted chat line (#272): classify and relay, then leave typing mode. A say/whisper
		// goes to the wire; an emote also predicts locally for zero lag; a bad command surfaces a
		// local usage notice; an empty line just closes.
		const submitChat = (text: string): void => {
			const line = text.trim();
			if (line) {
				const cmd = parseChatCommand(line);
				if (cmd.kind === 'say') net.send({ t: 'chat', text: cmd.text });
				else if (cmd.kind === 'whisper')
					net.send({ t: 'whisper', to: cmd.to, text: cmd.text });
				else if (cmd.kind === 'emote') {
					// Arm the predicted Avatar now; clientStepAvatar advances it and cancels on
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
			// The no-Kitty notice owns the keyboard first (it can resolve a beat into play on a
			// slow probe): the first key dismisses it and is swallowed (#228, #301).
			if (noKittyNotice.open) {
				dismissNoKittyNotice();
				return;
			}
			// While typing, chat OWNS the keyboard: the focused InputRenderable edits the line and
			// submits on Enter; here Escape closes and every other key is swallowed (no leak, #272).
			if (hud.chatOpen) {
				if (k.name === 'escape') hud.closeChat();
				return;
			}
			if (k.name === 'q') quit();
			// The options modal owns the keyboard while open (after the chat block, so typing
			// still wins): arrows/m adjust the mixer, o/esc close.
			if (options.open) {
				options.key(k.name);
				return;
			}
			// The controls overlay owns the keyboard while open: `?`/esc close, rest swallowed.
			if (controls.open) {
				if (isHelpKey(k) || k.name === 'escape') controls.hide();
				return;
			}
			// `m` toggles master mute (ADR 0014). After the chat block so it types while chatting
			// and only mutes during play.
			if (k.name === 'm') {
				sound.toggleMute();
				return;
			}
			// The Merchant overlay owns the keyboard while open (#267/#273): swallow every key.
			if (shop.open) {
				handleShopKey(k.name);
				return;
			}
			// The re-customize creator owns the keyboard while open (#305): Escape cancels, Enter
			// confirms → `setCosmetics`, every other key drives the picker; all swallowed.
			if (recustomize?.open) {
				if (isMenuBlipKey(k.name)) sound.play('ui');
				if (k.name === 'escape') {
					recustomize.hide();
					return;
				}
				const result = recustomize.key(k);
				if (result) {
					net.send({ t: 'setCosmetics', cosmetics: result.cosmetics });
					recustomize.hide();
				}
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
			// `c` reopens the creator to re-customize (#305, ADR 0028) — Town-only (the server
			// re-checks); outside a Town it just drops a hint.
			if (k.name === 'c') {
				if (zone.type === 'town') openRecustomize();
				else net.notice('Re-customize in Town.');
				return;
			}
			if (k.name === 'return') {
				// Open chat and CONSUME this Enter so it isn't also delivered to the input we just
				// focused — the InputRenderable subscribes during this same dispatch, so an un-consumed
				// Enter would submit an empty line and snap chat shut again (#272).
				k.preventDefault();
				hud.openChat();
				input.clear(); // a key held at the switch must not stick while typing
				return;
			}
			// Open the Merchant when standing at one (#267): swallow the interact key so it isn't
			// also fed to the sim as a Portal intent, and clear held movement.
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
		// Level-up flourish: null until the first snapshot so a reconnect at an already-high
		// level can't false-trigger; then fires once on each rising edge.
		let prevLevel: number | null = null;
		renderer.setFrameCallback(async (dt) => {
			// Freeze movement / combat while a modal has the keyboard; the same gate suppresses
			// the interact edge on send so a menu can't fire a Portal from under itself.
			const modalActive =
				hud.chatOpen ||
				controls.open ||
				shop.open ||
				options.open ||
				(recustomize?.open ?? false) ||
				noKittyNotice.open;
			const inp = modalActive ? IDLE_INPUT : input.poll(performance.now());

			// Follow a server-driven Zone change (portal / respawn): swap the local Zone and snap
			// the predicted Avatar to the arrival position so it doesn't briefly run in the old one.
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

			// A Dodge hop (ADR 0017 §5): a momentum impulse applied BEFORE physics so
			// clientStepAvatar integrates it this frame. Gated by the full Dodge gate, evaluated
			// HERE before the hop's pop ungrounds the body; the one gated decision drives the
			// impulse, the i-frame timer, and the report to the server, so all three agree.
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
			// Self SoundEffects on our own predicted Avatar: jump blip on take-off, footfall on land.
			if (jumpStarted({ onGround: prevOnGround }, predicted))
				sound.play('jump');
			if (landed({ onGround: prevOnGround }, predicted)) sound.play('land');
			const dtSec = Math.min(dt / 1000, PHYS.maxDt);
			// Fold through the EXACT shared per-Avatar function the server runs (ADR 0022): both
			// sides calling one function keeps the local telegraph/Guard/Dodge from diverging from
			// the authoritative outcome. Returns the outgoing hitbox + damage for blood prediction
			// (ADR 0013); HP reconciliation stays server-owned. A fired Skill overrides the swing.
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
			// Skill cooldowns ride the predicted avatar; the outgoing box for blood prediction below
			// is the projected player Strike, 0 or 1 this tick (ADR 0022).
			predicted = fold.avatar;
			const strike = fold.strikes[0];
			const hitbox = strike?.hitbox ?? null;
			const hitDamage = strike?.damage ?? 0;

			// Server owns vitals; reconcile HP/i-frames from snapshots. Position is NOT reconciled:
			// the client is authoritative over it (ADR 0001) and the snapshot only echoes our position
			// from ~one RTT ago, so snapping would drag the Avatar backward every moving frame (#68).
			// Server teleports arrive as a Zone change, handled above.
			const own = net.ownAvatar();
			if (own) {
				predicted.hp = own.hp;
				predicted.maxHp = own.maxHp;
				predicted.hurtT = own.hurtT;
			}

			sendAcc += dt;
			if (sendAcc >= SEND_INTERVAL) {
				sendAcc = 0;
				// Read the latched interact edge once per send (not per poll, which runs far faster) so
				// a single press hits the wire once. During a modal, still drain it but report false so
				// it clears instead of firing a Portal when the menu closes.
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
					// the gated decision, so the server starts the i-frame timer only if the hop fired
					// client-side, not on every key-press (ADR 0017 §5).
					dodge: dodging,
					skill: inp.skill,
				});
			}

			const fps = meter(dt);
			// Co-present entities render interpolated ~100 ms in the past for smooth motion between
			// ticks; the own Avatar stays purely predicted (only vitals reconcile), so local motion
			// is never dragged backward by latency.
			const view = net.sample(performance.now());
			// Age over-head Speech bubbles by wall time, then stamp the live ones onto their
			// senders' entities for the playfield to draw (#59, ADR 0007).
			net.decayBubbles(dt / 1000);
			const game = snapshotToGame(
				zone,
				predicted,
				net.sessionId,
				view,
				predicted.skillCooldowns ?? {},
				net.bubbles,
			);
			playfield.game = game;
			// Level-up flourish off the server-authoritative level: sound, a gold burst at the
			// Avatar (spawned off the just-set playfield state so it lands on the fresh position),
			// and the HUD banner (#271).
			const snapLevel = net.latest?.progress.level;
			if (snapLevel != null) {
				if (prevLevel != null && leveledUp(prevLevel, snapLevel)) {
					sound.play('level-up');
					playfield.levelUpBurst();
					hud.flashLevelUp();
				}
				prevLevel = snapLevel;
			}
			// Predict our own outgoing-hit blood off the rendered Monsters so it erupts instantly;
			// the server suppresses the matching Effect back to us, so no double-render (ADR 0013).
			// Deduped by `predicted.swingHits`. A mispredicted swing leaves a harmless stray splat —
			// no rollback.
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
			// Re-render the Merchant from the freshest snapshot so a completed sell/buy shows the
			// moment the server confirms it (#267/#273).
			if (shop.open) shop.update(shopView());
		});
	}
}

// Start last: runNetworked reads the `LOCAL_ZONES` const above, so invoking it earlier
// would hit that const's temporal dead zone.
runNetworked(SERVER);

renderer.start();
