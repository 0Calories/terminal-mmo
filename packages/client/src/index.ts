import {
	aabbOverlap,
	activeZone,
	applyImpulse,
	COMBAT,
	type Cosmetics,
	canStartDodge,
	clientStepAvatar,
	createGame,
	type Entity,
	entityBox,
	type GameState,
	type Input,
	loadZones,
	PHYS,
	predictHitEffects,
	randomCosmetics,
	resolveCombat,
	SPAWN,
	saleValue,
	sellItem,
	spawnAvatar,
	step,
	type Zone,
} from '@mmo/shared';
import { createCliRenderer } from '@opentui/core';
import { AudioOptions } from './audio-options-view';
import { CharacterCreator } from './character-creator';
import { ChatInput, parseChatCommand } from './chat';
import { ConfigStore } from './config';
import { Hud } from './hud';
import { InputState } from './input';
import { NetClient, snapshotToGame } from './net';
import { PlayfieldRenderable } from './playfield';
import { resolveServerUrl } from './server-url';
import { Shop } from './shop';
import { SoundSystem } from './sound/system';
import {
	isMenuBlipKey,
	jumpStarted,
	landed,
	leveledUp,
} from './sound/triggers';
import { CLIENT_VERSION } from './version';

// The sim is dt-based, so this only affects smoothness + CPU, never game speed.
// Default 120 for high-refresh displays; override with MMO_FPS — e.g. MMO_FPS=60
// on a 60Hz panel, or over SSH where the refresh is unknowable (#22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// Connection resolution (ADR 0009 / 0012): MMO_OFFLINE forces the single-player loop;
// otherwise resolveServerUrl picks the target — an explicit MMO_SERVER override
// (e.g. MMO_SERVER=ws://localhost:8080) wins, a from-source `dev` client defaults to
// the local dev server, and a published client defaults to the live World on Railway.
const OFFLINE =
	process.env.MMO_OFFLINE === '1' || process.env.MMO_OFFLINE === 'true';
const SERVER = resolveServerUrl(process.env.MMO_SERVER, CLIENT_VERSION);

// No movement / combat this frame — fed to the sim while a modal (shop, chat)
// owns the keyboard, so held keys don't drive the Avatar.
const IDLE_INPUT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
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
const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
// In the mouse scheme, route the playfield's left mouse button to the attack intent
// (OpenTUI fires these alongside held movement keys). Wired once here so both loops
// inherit it; a no-op in the keyboard scheme.
if (SCHEME === 'mouse') {
	playfield.onMouseDown = (e: { button: number }) => input.mouseDown(e.button);
	playfield.onMouseUp = (e: { button: number }) => input.mouseUp(e.button);
}
const hud = new Hud(renderer);
hud.attach(renderer.root);

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

function quit(message?: string) {
	sound.dispose(); // tear the engine down without blocking exit
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	// Printed after the TUI is torn down so it lands on the normal screen, not the
	// cleared alt-screen (e.g. a server rejection reason, ADR 0009).
	if (message) console.error(message);
	process.exit(message ? 1 : 0);
}

// A running FPS estimate shared by both loops.
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

// --- Offline single-player (M1 loop) ---------------------------------------

function runOffline() {
	let game = createGame();
	const shop = new Shop(renderer);
	shop.attach(renderer.root);
	// Audio options modal (ADR 0014/0015): a global, Shop-class overlay opened with `o`.
	const options = new AudioOptions(renderer, sound);
	options.attach(renderer.root);

	function vendorUnder(g: GameState) {
		const zone = activeZone(g.world, g.player.zoneId);
		const box = entityBox(g.player.avatar);
		return (
			(zone.npcs ?? []).find(
				(n) => n.kind === 'vendor' && aabbOverlap(box, n),
			) ?? null
		);
	}

	function sellSelected() {
		const inv = game.player.inventory;
		if (inv.length === 0) return;
		const item = inv[shop.selected];
		const { progress, inventory } = sellItem(
			game.player.progress,
			inv,
			item.id,
		);
		const log = [
			...game.player.log.slice(-5),
			`Sold ${item.rarity} ${item.base} (+${saleValue(item)}g).`,
		];
		game = { ...game, player: { ...game.player, progress, inventory, log } };
		shop.move(0, inventory.length); // clamp selection into the new bounds
	}

	function handleShopKey(name: string) {
		// UI blip on menu navigation / confirm (ADR 0014): a centered, full-volume
		// interface click. Close (e/esc) is silent — it marks moving *through* a menu.
		if (isMenuBlipKey(name)) sound.play('ui');
		const count = game.player.inventory.length;
		switch (name) {
			case 'up':
				shop.move(-1, count);
				break;
			case 'down':
				shop.move(1, count);
				break;
			case 'return':
				sellSelected();
				break;
			case 'e':
			case 'escape':
				shop.hide();
				break;
		}
		if (shop.open) shop.update(game.player);
	}

	renderer.keyInput.on('keypress', (k) => {
		if (k.name === 'q') quit();
		// `m` toggles master mute instantly (ADR 0014), reachable even with the shop
		// modal open — it's a global audio control, not a gameplay/menu key.
		// While the options modal is open it owns the keyboard: arrows/m adjust the
		// mixer (persisted live), o/esc close. Swallow every key so none hits the sim.
		if (options.open) {
			options.key(k.name);
			return;
		}
		if (k.name === 'm') {
			sound.toggleMute();
			return;
		}
		if (shop.open) {
			handleShopKey(k.name);
			return;
		}
		if (k.name === 'o') {
			options.show();
			return;
		}
		// Swallow the key so it isn't also fed to the sim as a portal/interact intent.
		if (k.name === 'e' && vendorUnder(game)) {
			shop.show();
			shop.update(game.player);
			return;
		}
		input.press(k.name, performance.now());
	});
	renderer.keyInput.on('keyrelease', (k) => input.release(k.name));

	const meter = fpsMeter();
	let prevLevel = game.player.progress.level;
	renderer.setFrameCallback(async (dt) => {
		const prevAvatar = game.player.avatar;
		game = step(
			game,
			shop.open ? IDLE_INPUT : input.poll(performance.now()),
			dt,
		);
		// Self SoundEffects (client-local, centered, full volume): the jump blip on
		// the take-off frame and the landing footfall on the touchdown frame.
		if (jumpStarted(prevAvatar, game.player.avatar)) sound.play('jump');
		if (landed(prevAvatar, game.player.avatar)) sound.play('land');
		// Level-up flourish, once per rising edge of the Player's level.
		const level = game.player.progress.level;
		if (leveledUp(prevLevel, level)) sound.play('level-up');
		prevLevel = level;
		const fps = meter(dt);
		playfield.game = game;
		hud.update(game, fps);
		if (shop.open) shop.update(game.player);
	});
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

function runNetworked(url: string) {
	const handle = process.env.USER || 'wanderer';
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
	creator.show();

	// Phase 1 — the picker owns the keyboard: every key drives a selection and, on
	// Enter, hands back the chosen Cosmetics. `started` makes this handler inert once
	// play() has taken over the keys (its own listener is added then), so the two
	// phases never both react to a key.
	let started = false;
	renderer.keyInput.on('keypress', (k) => {
		if (started) return;
		if (k.name === 'q') quit();
		// UI blip on customize navigation / confirm (ADR 0014), the same menu click
		// the shop uses — a centered, full-volume interface tick.
		if (isMenuBlipKey(k.name)) sound.play('ui');
		const chosen = creator.key(k.name);
		if (!chosen) return;
		started = true;
		creator.hide();
		play(chosen);
	});

	// Phase 2 — connect with the confirmed look and run the live World loop.
	function play(cosmetics: Cosmetics) {
		// On a server refusal (protocol mismatch / connection cap, ADR 0009), tear down
		// the TUI and print the reason so it isn't buried under the alt-screen.
		const net = new NetClient(
			url,
			handle,
			(reason) => {
				quit(reason);
			},
			cosmetics,
		);
		hud.showAlphaNotice(); // ephemeral live World (ADR 0009)
		// The Zone we currently render + predict against; swapped when the server moves
		// us between Zones (portal travel, death respawn).
		let zoneId = 'field-01';
		let zone = localZone(zoneId);

		// Own Avatar, predicted locally for zero input lag; the server corrects vitals
		// (and snaps position on respawn) via snapshots.
		let predicted: Entity = spawnAvatar(SPAWN.x, SPAWN.y);
		let localCd: Record<string, number> = {}; // predicted skill cooldowns (off-wire)
		const SEND_INTERVAL = 1000 / 30; // throttle input reports to ~30 Hz
		let sendAcc = 0;
		const chat = new ChatInput(); // Zone-local chat typing mode (#34)
		// Audio options modal (ADR 0014/0015): a global overlay opened with `o` during play.
		const options = new AudioOptions(renderer, sound);
		options.attach(renderer.root);

		renderer.keyInput.on('keypress', (k) => {
			// While typing, chat OWNS the keyboard: every key edits the line (or sends /
			// cancels) and none reaches movement / combat (no keystroke leak).
			if (chat.open) {
				const r = chat.key(k);
				if (r.action === 'send') {
					// A sent line is either a Zone-local say or a `/w` whisper (#40); a bad
					// whisper surfaces a local usage notice rather than going to the wire.
					const cmd = parseChatCommand(r.text);
					if (cmd.kind === 'say') net.send({ t: 'chat', text: cmd.text });
					else if (cmd.kind === 'whisper')
						net.send({ t: 'whisper', to: cmd.to, text: cmd.text });
					else if (cmd.kind === 'emote')
						net.send({ t: 'emote', emote: cmd.emote });
					else net.notice(cmd.message);
				}
				return;
			}
			if (k.name === 'q') quit();
			// The options modal owns the keyboard while open (after the chat block, so
			// typing still wins): arrows/m adjust the mixer (persisted live), o/esc close.
			if (options.open) {
				options.key(k.name);
				return;
			}
			// `m` toggles master mute instantly (ADR 0014). Placed after the chat block
			// so it edits the line while typing and only mutes during play.
			if (k.name === 'm') {
				sound.toggleMute();
				return;
			}
			if (k.name === 'o') {
				options.show();
				return;
			}
			if (k.name === 'return') {
				chat.start();
				input.clear(); // a key held at the switch must not stick while typing
				return;
			}
			input.press(k.name, performance.now());
		});
		// Ignore releases while typing so play-mode keys can't be toggled mid-message.
		renderer.keyInput.on('keyrelease', (k) => {
			if (!chat.open) input.release(k.name);
		});

		const meter = fpsMeter();
		// Level-up flourish: seeded from the first real snapshot (null until then) so a
		// reconnect at an already-high level can't false-trigger; thereafter it fires
		// once on each rising edge of the server-authoritative level.
		let prevLevel: number | null = null;
		renderer.setFrameCallback(async (dt) => {
			// Freeze movement / combat while the chat line has the keyboard.
			const inp = chat.open ? IDLE_INPUT : input.poll(performance.now());

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
			// impulse, the i-frame timer (resolveCombat below), and the report to the server,
			// so all three agree on whether the hop fired. Direction is `inp.moveX`.
			const dodging =
				(inp.dodge ?? false) && canStartDodge(predicted, inp.moveX);
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
			// Level-up flourish off the server-authoritative progression in the snapshot.
			const snapLevel = net.latest?.progress.level;
			if (snapLevel != null) {
				if (prevLevel != null && leveledUp(prevLevel, snapLevel))
					sound.play('level-up');
				prevLevel = snapLevel;
			}
			// Optimistic local telegraph (story 17): mirror the server's cooldown gate
			// so the swing/skill flash shows before the snapshot confirms the hit. The
			// same gate yields the outgoing hitbox + damage for blood prediction (ADR
			// 0013): a fired Skill overrides the basic swing, matching resolveAvatarIntent.
			const dtSec = Math.min(dt / 1000, PHYS.maxDt);
			const r = resolveCombat(
				predicted,
				localCd,
				net.latest?.progress.level ?? 1,
				'warrior',
				{ attack: inp.attack, skill: inp.skill, dodge: dodging },
				dtSec,
			);
			predicted.attackT = r.attackT;
			// Mirror the server's i-frame Dodge timer + its post-recovery cooldown so the
			// local pose and both gates stay in lockstep with the prediction (ADR 0017 §5).
			predicted.dodgeT = r.dodgeT;
			predicted.dodgeCdT = r.dodgeCdT;
			localCd = r.cooldowns;
			const hitbox = r.hitbox;
			const hitDamage = r.damage;

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
				net.send({
					t: 'input',
					x: predicted.x,
					y: predicted.y,
					vx: predicted.vx,
					vy: predicted.vy,
					facing: predicted.facing,
					onGround: predicted.onGround,
					attack: inp.attack,
					interact: inp.interact ?? false,
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
			net.decayEmotes(dt / 1000);
			const game = snapshotToGame(
				zone,
				predicted,
				net.sessionId,
				view,
				localCd,
				net.bubbles,
				net.emotes,
			);
			playfield.game = game;
			// Predict our own outgoing-hit blood off the rendered (interpolated)
			// Monsters, so it erupts instantly; the server suppresses the matching
			// Effect back to us, so there is no double-render (ADR 0013). A mispredicted
			// swing leaves a harmless stray splat — no rollback.
			if (hitbox) {
				const monsters = activeZone(game.world, game.player.zoneId).monsters;
				playfield.emitPredicted(
					predictHitEffects(hitbox, predicted.facing, hitDamage, monsters),
				);
			}
			hud.update(game, fps);
			hud.updateChat(net.chatLog, chat.open, chat.text);
		});
	}
}

// Dispatch + start last, after every module-level declaration: runNetworked reads
// the `LOCAL_ZONES` const (below), so invoking it earlier would hit that const's
// temporal dead zone (the functions themselves are hoisted and callable here).
if (OFFLINE) runOffline();
else runNetworked(SERVER);

renderer.start();
