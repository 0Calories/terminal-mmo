import {
	aabbOverlap,
	activeZone,
	createGame,
	entityBox,
	type GameState,
	type Input,
	saleValue,
	sellItem,
	step,
} from '@mmo/shared';
import { createCliRenderer } from '@opentui/core';
import { Hud } from './hud';
import { InputState } from './input';
import { PlayfieldRenderable } from './playfield';
import { Shop } from './shop';

// The sim is dt-based, so this only affects smoothness + CPU, never game speed.
// Default 120 for high-refresh displays; override with MMO_FPS — e.g. MMO_FPS=60
// on a 60Hz panel, or over SSH where the refresh is unknowable (#22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// Fed to the sim while the shop modal is open so menu keys don't leak into
// movement/combat.
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

let game = createGame();
const input = new InputState();

const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
const hud = new Hud(renderer);
hud.attach(renderer.root);
const shop = new Shop(renderer);
shop.attach(renderer.root);

function vendorUnder(g: GameState) {
	const zone = activeZone(g.world, g.player.zoneId);
	const box = entityBox(g.player.avatar);
	return (
		(zone.npcs ?? []).find((n) => n.kind === 'vendor' && aabbOverlap(box, n)) ??
		null
	);
}

function sellSelected() {
	const inv = game.player.inventory;
	if (inv.length === 0) return;
	const item = inv[shop.selected];
	const { progress, inventory } = sellItem(game.player.progress, inv, item.id);
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
	if (k.name === 'q') {
		try {
			(renderer as unknown as { destroy?: () => void }).destroy?.();
		} catch {}
		process.exit(0);
	}
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

let fps = 0;
let acc = 0;
let frames = 0;

renderer.setFrameCallback(async (dt) => {
	game = step(game, shop.open ? IDLE_INPUT : input.poll(performance.now()), dt);
	acc += dt;
	frames++;
	if (acc >= 500) {
		fps = Math.round((frames * 1000) / acc);
		acc = 0;
		frames = 0;
	}
	playfield.game = game;
	hud.update(game, fps);
	if (shop.open) shop.update(game.player);
});
renderer.start();
