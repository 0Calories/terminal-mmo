// @mmo/client — runnable single-player core loop (M1). Run in a real terminal:
//   bun run dev   (from packages/client)  or   bun run dev:client  (from root)
//
// All game logic lives in @mmo/shared; this file only does I/O: render, input,
// and driving the deterministic `step` each frame.

import { createGame, step } from '@mmo/shared';
import { createCliRenderer } from '@opentui/core';
import { Hud } from './hud';
import { InputState } from './input';
import { PlayfieldRenderable } from './playfield';

const renderer = await createCliRenderer({
	targetFps: 60,
	exitOnCtrlC: true,
	backgroundColor: '#10121a',
	// Report press/repeat/RELEASE for continuous held movement (M0 finding).
	useKittyKeyboard: { events: true },
});

let game = createGame();
const input = new InputState();

// Scene graph (ADR 0005): the playfield fills the root and draws the world each
// frame; the HUD overlays it as layout-driven renderables on a higher zIndex.
// Both are kept current by the frame loop below.
const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
const hud = new Hud(renderer);
hud.attach(renderer.root);

renderer.keyInput.on('keypress', (k) => {
	if (k.name === 'q') {
		try {
			(renderer as unknown as { destroy?: () => void }).destroy?.();
		} catch {}
		process.exit(0);
	}
	input.press(k.name, performance.now());
});
renderer.keyInput.on('keyrelease', (k) => input.release(k.name));

let fps = 0;
let acc = 0;
let frames = 0;

renderer.setFrameCallback(async (dt) => {
	game = step(game, input.poll(performance.now()), dt);
	acc += dt;
	frames++;
	if (acc >= 500) {
		fps = Math.round((frames * 1000) / acc);
		acc = 0;
		frames = 0;
	}
	playfield.game = game;
	hud.update(game, fps);
});
renderer.start();
