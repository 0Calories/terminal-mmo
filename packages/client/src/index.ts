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

const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

const SERVER = resolveServerUrl(process.env.MMO_SERVER, CLIENT_VERSION);

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
	// events: true reports key releases, needed for continuous held movement.
	useKittyKeyboard: { events: true },
});

const SCHEME = process.env.MMO_SCHEME === 'mouse' ? 'mouse' : 'keyboard';
const input = new InputState(SCHEME);
const INTERACT_KEY = SCHEME === 'mouse' ? 'f' : 'e';

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
if (SCHEME === 'mouse') {
	playfield.onMouseDown = (e: { button: number }) => input.mouseDown(e.button);
	playfield.onMouseUp = (e: { button: number }) => input.mouseUp(e.button);
}
const hud = new Hud(renderer);
hud.attach(renderer.root);

// OpenTUI's kitty_keyboard false-defaults before the async probe resolves, so warn only once the probe burst settles quiet with the flag still false — else capable terminals like Ghostty falsely warn.
const noKittyNotice = new NoKittyNotice(renderer);
noKittyNotice.attach(renderer.root);
const gate = new NoticeGate(noKittyNotice);
const KITTY_PROBE_SETTLE_MS = 500;
let kittyConfirmed = false;
let kittySettleTimer: ReturnType<typeof setTimeout> | null = null;
function warnNoKittyNow(): void {
	kittySettleTimer = null;
	if (kittyConfirmed || noKittyNotice.open) return;
	if (shouldWarnNoKitty(renderer.capabilities)) {
		noKittyNotice.show();
		gate.reconcile();
	}
}
function onKittyCapabilities(capabilities: TerminalCapabilities | null): void {
	if (capabilities?.kitty_keyboard === true) {
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
	if (kittyConfirmed) return;
	if (kittySettleTimer) clearTimeout(kittySettleTimer);
	kittySettleTimer = setTimeout(warnNoKittyNow, KITTY_PROBE_SETTLE_MS);
}
function dismissNoKittyNotice(): void {
	noKittyNotice.hide();
	gate.reconcile();
}
renderer.on('capabilities', (capabilities: TerminalCapabilities) =>
	onKittyCapabilities(capabilities),
);
// Act on a positive only; the pre-probe default false isn't authoritative.
if (renderer.capabilities?.kitty_keyboard === true) kittyConfirmed = true;

const sound = new SoundSystem({ debug: process.env.MMO_DEBUG === '1' });
playfield.sound = sound;

const config = new ConfigStore().load();
sound.applyAudioPrefs(config.audio());
sound.onChange = () => config.saveAudio(sound.audioPrefs());
let audioDegraded = false;
sound.onDegraded = () => {
	audioDegraded = true;
};

let identityNotice: string | null = null;

function quit(message?: string) {
	sound.dispose();
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	// Print after teardown so it lands on the normal screen, not the cleared alt-screen.
	if (audioDegraded)
		console.error('audio disabled after repeated engine errors this session');
	if (identityNotice) console.error(identityNotice);
	if (message) console.error(message);
	process.exit(message ? 1 : 0);
}

// Some terminals report `?` only as a sequence, not a name.
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

const LOCAL_ZONES = new Map<string, Zone>(loadZones().map((z) => [z.id, z]));
function localZone(id: string): Zone {
	return LOCAL_ZONES.get(id) ?? LOCAL_ZONES.get('field-01') ?? loadZones()[0];
}

async function runNetworked(url: string) {
	const fromUser = (process.env.USER || '')
		.replace(/[^A-Za-z0-9_-]/g, '-')
		.slice(0, 16);
	const handle =
		process.env.MMO_HANDLE || (fromUser.length >= 2 ? fromUser : 'wanderer');
	const resolved = await discoverSshIdentity(config);
	if (!resolved.ok) {
		quit(resolved.refusal);
		return;
	}
	const identity = resolved.identity;
	identityNotice = resolved.notice ?? null;
	const creator = new CharacterCreator(
		renderer,
		handle,
		randomCosmetics((Math.random() * 0x7fffffff) | 0),
	);

	let started = false;
	let creating = false;

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
				gate.request(creator);
			} else {
				play();
			}
		},
	);

	net.onCreateRejected = (reason) => {
		creator.showRejection(reason);
	};
	net.onSpawned = () => {
		if (creating) {
			creating = false;
			gate.release(creator);
		}
		play();
	};

	renderer.keyInput.on('keypress', (k) => {
		if (started) return;
		if (noKittyNotice.open) {
			dismissNoKittyNotice();
			return;
		}
		if (!creating) {
			if (k.name === 'q') quit();
			return;
		}
		if (isMenuBlipKey(k.name)) sound.play('ui');
		const result = creator.key(k);
		if (!result) return;
		creator.setBusy(true);
		net.send({
			t: 'createAvatar',
			handle: result.handle,
			cosmetics: result.cosmetics,
		});
	});

	function play() {
		if (started) return;
		started = true;
		hud.showAlphaNotice();
		let zoneId = 'field-01';
		let zone = localZone(zoneId);

		let predicted: Entity = {
			...spawnAvatar(SPAWN.x, SPAWN.y),
			weapon: WEAPON,
		};
		const SEND_INTERVAL = 1000 / 30;
		let sendAcc = 0;
		const options = new AudioOptions(renderer, sound);
		options.attach(renderer.root);
		const controls = new Controls(renderer);
		controls.attach(renderer.root);
		const shop = new Shop(renderer);
		shop.attach(renderer.root);
		let recustomize: CharacterCreator | null = null;
		const openRecustomize = (): void => {
			const own = net.ownAvatar();
			const cos = own?.cosmetics ?? DEFAULT_COSMETICS;
			if (!recustomize) {
				// Use the snapshot's handle, not net.handle: this session's net.handle still holds the pre-claim handshake name.
				const durableHandle = own?.handle ?? net.handle;
				recustomize = new CharacterCreator(renderer, durableHandle, cos, false);
				recustomize.attach(renderer.root);
			} else {
				recustomize.reopen(cos);
			}
			input.clear();
			recustomize.show();
		};
		const shopView = (): ShopView => ({
			inventory: net.latest?.inventory ?? [],
			progress: net.latest?.progress ?? { level: 1, xp: 0, gold: 0 },
		});
		const merchantUnder = (): boolean => {
			const box = entityBox(predicted);
			return (zone.npcs ?? []).some(
				(n) => n.kind === 'vendor' && aabbOverlap(box, n),
			);
		};
		const sellSelected = (): void => {
			const inv = shopView().inventory;
			const item = inv[shop.selected];
			if (!item) return;
			net.send({ t: 'sell', itemId: item.id });
			shop.move(0, Math.max(0, inv.length - 1));
		};
		const buySelected = (): void => {
			net.send({ t: 'buy', index: shop.selected });
		};
		const handleShopKey = (name: string): void => {
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

		const submitChat = (text: string): void => {
			const line = text.trim();
			if (line) {
				const cmd = parseChatCommand(line);
				if (cmd.kind === 'say') net.send({ t: 'chat', text: cmd.text });
				else if (cmd.kind === 'whisper')
					net.send({ t: 'whisper', to: cmd.to, text: cmd.text });
				else if (cmd.kind === 'emote') {
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
			if (noKittyNotice.open) {
				dismissNoKittyNotice();
				return;
			}
			if (hud.chatOpen) {
				if (k.name === 'escape') hud.closeChat();
				return;
			}
			if (k.name === 'q') quit();
			if (options.open) {
				options.key(k.name);
				return;
			}
			if (controls.open) {
				if (isHelpKey(k) || k.name === 'escape') controls.hide();
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
			if (k.name === 'c') {
				if (zone.type === 'town') openRecustomize();
				else net.notice('Re-customize in Town.');
				return;
			}
			if (k.name === 'return') {
				// Consume this Enter: the input subscribes during this same dispatch and would else submit an empty line.
				k.preventDefault();
				hud.openChat();
				input.clear();
				return;
			}
			if (k.name === INTERACT_KEY && merchantUnder()) {
				input.clear();
				shop.show();
				shop.update(shopView());
				return;
			}
			input.press(k.name, performance.now());
		});
		renderer.keyInput.on('keyrelease', (k) => {
			if (!hud.chatOpen) input.release(k.name);
		});

		const meter = fpsMeter();
		// null until the first snapshot so a reconnect at an already-high level can't false-trigger.
		let prevLevel: number | null = null;
		renderer.setFrameCallback(async (dt) => {
			const modalActive =
				hud.chatOpen ||
				controls.open ||
				shop.open ||
				options.open ||
				(recustomize?.open ?? false) ||
				noKittyNotice.open;
			const inp = modalActive ? IDLE_INPUT : input.poll(performance.now());

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

			// Apply the dodge impulse before physics so clientStepAvatar integrates it this frame.
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
			if (jumpStarted({ onGround: prevOnGround }, predicted))
				sound.play('jump');
			if (landed({ onGround: prevOnGround }, predicted)) sound.play('land');
			const dtSec = Math.min(dt / 1000, PHYS.maxDt);
			// Must fold through the same shared function the server runs, else prediction diverges.
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
			predicted = fold.avatar;
			const strike = fold.strikes[0];
			const hitbox = strike?.hitbox ?? null;
			const hitDamage = strike?.damage ?? 0;

			// Don't reconcile position: the snapshot echoes our pos ~1 RTT stale, so snapping drags the Avatar backward.
			const own = net.ownAvatar();
			if (own) {
				predicted.hp = own.hp;
				predicted.maxHp = own.maxHp;
				predicted.hurtT = own.hurtT;
			}

			sendAcc += dt;
			if (sendAcc >= SEND_INTERVAL) {
				sendAcc = 0;
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
					dodge: dodging,
					skill: inp.skill,
				});
			}

			const fps = meter(dt);
			const view = net.sample(performance.now());
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
			const snapLevel = net.latest?.progress.level;
			if (snapLevel != null) {
				if (prevLevel != null && leveledUp(prevLevel, snapLevel)) {
					sound.play('level-up');
					playfield.levelUpBurst();
					hud.flashLevelUp();
				}
				prevLevel = snapLevel;
			}
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
			if (shop.open) shop.update(shopView());
		});
	}
}

// Start last: runNetworked reads LOCAL_ZONES above, which would be in its TDZ if invoked earlier.
runNetworked(SERVER);

renderer.start();
