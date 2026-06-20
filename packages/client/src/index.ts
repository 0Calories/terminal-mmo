// @mmo/client — runnable single-player core loop (M1). Run in a real terminal:
//   bun run dev   (from packages/client)  or   bun run dev:client  (from root)
//
// All game logic lives in @mmo/shared; this file only does I/O: render, input,
// and driving the deterministic `step` each frame.

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

// Render/sim cadence. The sim is dt-based (@mmo/shared), so this only affects
// smoothness + CPU, never game speed. Default 120 for high-refresh displays
// (ProMotion etc.); override with MMO_FPS — e.g. MMO_FPS=60 on a 60Hz panel, or
// over SSH where the display refresh is unknowable (autodetect parked, #22).
const RENDER_FPS = Number(process.env.MMO_FPS) || 120;

// Input fed to the sim while a modal (the vendor shop) is open: the Avatar holds
// still and ignores the world so menu keys don't leak into movement/combat.
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
	// Report press/repeat/RELEASE for continuous held movement (M0 finding).
	useKittyKeyboard: { events: true },
});

let game = createGame();
const input = new InputState();

// Scene graph (ADR 0005): the playfield fills the root and draws the world each
// frame; the HUD + shop overlay it as layout-driven renderables on higher zIndex.
const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
const hud = new Hud(renderer);
hud.attach(renderer.root);
const shop = new Shop(renderer);
shop.attach(renderer.root);

/** The vendor NPC the Avatar is currently standing on, if any (story 29). */
function vendorUnder(g: GameState) {
	const zone = activeZone(g.world, g.player.zoneId);
	const box = entityBox(g.player.avatar);
	return (
		(zone.npcs ?? []).find((n) => n.kind === 'vendor' && aabbOverlap(box, n)) ??
		null
	);
}

/** Sell the highlighted Item: pure transaction in @mmo/shared, then fold the new
 * Gold/inventory back into game state for the next tick to carry. */
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

/** Route a keypress while the shop modal is open (navigation, not the world). */
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
	// interact on a vendor opens the shop (swallow the key so it isn't also fed to
	// the sim as a portal/interact intent); otherwise it's a normal world input.
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
	// Freeze world input while the shop is open so the Avatar stays put.
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
