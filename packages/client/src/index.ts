import {
	aabbOverlap,
	activeZone,
	COMBAT,
	clientStepAvatar,
	createGame,
	type Entity,
	entityBox,
	type GameState,
	type Input,
	makeFieldZone,
	PHYS,
	SPAWN,
	saleValue,
	sellItem,
	skillForSlot,
	skillUnlocked,
	spawnAvatar,
	step,
} from '@mmo/shared';
import { createCliRenderer } from '@opentui/core';
import { Hud } from './hud';
import { InputState } from './input';
import { NetClient, snapshotToGame } from './net';
import { PlayfieldRenderable } from './playfield';
import { Shop } from './shop';

// The sim is dt-based, so this only affects smoothness + CPU, never game speed.
// Default 120 for high-refresh displays; override with MMO_FPS — e.g. MMO_FPS=60
// on a 60Hz panel, or over SSH where the refresh is unknowable (#22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// Set MMO_SERVER=ws://host:port to play against the M2 server (ADR 0006);
// unset runs the offline single-player loop.
const SERVER = process.env.MMO_SERVER;

const renderer = await createCliRenderer({
	targetFps: RENDER_FPS,
	exitOnCtrlC: true,
	backgroundColor: '#10121a',
	// Report RELEASE events for continuous held movement (M0 finding).
	useKittyKeyboard: { events: true },
});

const input = new InputState();
const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
const hud = new Hud(renderer);
hud.attach(renderer.root);

function quit() {
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	process.exit(0);
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

if (SERVER) runNetworked(SERVER);
else runOffline();

renderer.start();

// --- Offline single-player (M1 loop) ---------------------------------------

function runOffline() {
	let game = createGame();
	const shop = new Shop(renderer);
	shop.attach(renderer.root);

	const IDLE_INPUT: Input = {
		moveX: 0,
		jump: false,
		attack: false,
		interact: false,
	};

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
		if (shop.open) {
			handleShopKey(k.name);
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
	renderer.setFrameCallback(async (dt) => {
		game = step(
			game,
			shop.open ? IDLE_INPUT : input.poll(performance.now()),
			dt,
		);
		const fps = meter(dt);
		playfield.game = game;
		hud.update(game, fps);
		if (shop.open) shop.update(game.player);
	});
}

// --- Networked (M2) ---------------------------------------------------------

function runNetworked(url: string) {
	const handle = process.env.USER || 'wanderer';
	const net = new NetClient(url, handle);
	const field = makeFieldZone('field-01');

	// Own Avatar, predicted locally for zero input lag; the server corrects vitals
	// (and snaps position on respawn) via snapshots.
	let predicted: Entity = spawnAvatar(SPAWN.x, SPAWN.y);
	const localCd: Record<string, number> = {}; // predicted skill cooldowns (off-wire)
	const RECONCILE = 3; // cells of position drift before we snap to the server
	const SEND_INTERVAL = 1000 / 30; // throttle input reports to ~30 Hz
	let sendAcc = 0;

	renderer.keyInput.on('keypress', (k) => {
		if (k.name === 'q') quit();
		input.press(k.name, performance.now());
	});
	renderer.keyInput.on('keyrelease', (k) => input.release(k.name));

	const meter = fpsMeter();
	renderer.setFrameCallback(async (dt) => {
		const inp = input.poll(performance.now());

		predicted = clientStepAvatar(
			field.terrain,
			predicted,
			{ moveX: inp.moveX, jump: inp.jump },
			dt,
		);
		// Optimistic local telegraph (story 17): mirror the server's cooldown gate
		// so the swing/skill flash shows before the snapshot confirms the hit.
		if (inp.attack && predicted.attackT <= 0)
			predicted.attackT = COMBAT.attackCooldown;
		const dtSec = Math.min(dt / 1000, PHYS.maxDt);
		for (const id in localCd) localCd[id] = Math.max(0, localCd[id] - dtSec);
		const level = net.latest?.progress.level ?? 1;
		if (inp.skill) {
			const skill = skillForSlot('warrior', inp.skill);
			if (skill && skillUnlocked(skill, level) && (localCd[skill.id] ?? 0) <= 0)
				localCd[skill.id] = skill.cooldown;
		}

		// Server owns vitals; reconcile HP/i-frames and snap on a large divergence
		// (respawn teleports the Avatar back to the safe point).
		const own = net.ownAvatar();
		if (own) {
			predicted.hp = own.hp;
			predicted.maxHp = own.maxHp;
			predicted.hurtT = own.hurtT;
			if (
				Math.abs(own.x - predicted.x) > RECONCILE ||
				Math.abs(own.y - predicted.y) > RECONCILE
			) {
				predicted.x = own.x;
				predicted.y = own.y;
				predicted.vx = 0;
				predicted.vy = 0;
			}
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
				skill: inp.skill,
			});
		}

		const fps = meter(dt);
		// Co-present entities are rendered from the buffer, interpolated ~100 ms in
		// the past for smooth motion between ticks; the own Avatar stays predicted
		// (reconciled above against net.latest, not the delayed view).
		const view = net.sample(performance.now());
		const game = snapshotToGame(field, predicted, net.sessionId, view, localCd);
		playfield.game = game;
		hud.update(game, fps);
	});
}
