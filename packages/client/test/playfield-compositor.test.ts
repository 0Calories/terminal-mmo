import { expect, test } from 'bun:test';
import { activeZone } from '@mmo/core/protocol';
import { Compositor } from '@mmo/render/compositor';
import { paintActor } from '@mmo/render/sprites';
import type { OptimizedBuffer, RGBA } from '@opentui/core';
import { ParticleEngine } from '../src/particles';
import { initCameraState, stepCamera } from '../src/render/camera';
import { DodgeTracker } from '../src/render/dodge-echo';
import { drawPlayfield } from '../src/render/scene';
import { entity, GOLDEN_VIEW, goldenGame, seededRng } from './helpers';

const TERRAIN_FG: [number, number, number, number] = [70, 82, 104, 255];
const TERRAIN_BG: [number, number, number, number] = [34, 40, 54, 255];

interface Recorded {
	char: string;
	fg: [number, number, number, number];
	bg: [number, number, number, number];
}

function recordingBuffer(width: number, height: number) {
	const cells = new Map<string, Recorded>();
	const counts = { setCell: 0, alpha: 0, duplicate: 0 };
	const buf = {
		width,
		height,
		clear() {},
		setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA) {
			const key = `${x},${y}`;
			if (cells.has(key)) counts.duplicate++;
			cells.set(key, { char, fg: fg.toInts(), bg: bg.toInts() });
			counts.setCell++;
		},
		setCellWithAlphaBlending() {
			counts.alpha++;
		},
	};
	return { buf: buf as unknown as OptimizedBuffer, cells, counts };
}

function baseCam(game = goldenGame()) {
	const a = game.player.avatar;
	const zone = activeZone(game.world, game.player.zoneId);
	const state = stepCamera(initCameraState(), game.player.zoneId, a.x, a.y, {
		sw: GOLDEN_VIEW.width,
		sh: GOLDEN_VIEW.height,
		ww: zone.terrain.w,
		wh: zone.terrain.h,
	});
	if (!state.cam) throw new Error('camera did not resolve');
	return { game, cam: state.cam };
}

test('the whole frame encodes to OpenTUI exactly once — one setCell per cell, no alpha writes at the seam', () => {
	const { game, cam } = baseCam();
	const compositor = new Compositor(GOLDEN_VIEW.width, GOLDEN_VIEW.height);
	const { buf, cells, counts } = recordingBuffer(
		GOLDEN_VIEW.width,
		GOLDEN_VIEW.height,
	);
	const particles = new ParticleEngine(seededRng(1));
	particles.step(0, activeZone(game.world, game.player.zoneId).terrain);

	drawPlayfield(buf, compositor, game, cam, {
		particles,
		dodges: new DodgeTracker(),
	});

	const total = GOLDEN_VIEW.width * GOLDEN_VIEW.height;
	expect(counts.setCell).toBe(total);
	expect(cells.size).toBe(total);
	expect(counts.duplicate).toBe(0);
	// The output adapter is the single seam: no producer alpha-blends to OpenTUI.
	expect(counts.alpha).toBe(0);
});

test('the composed frame carries each back-to-front pass: terrain, projectile combat, and a frontmost bubble', () => {
	const { game, cam } = baseCam();
	const compositor = new Compositor(GOLDEN_VIEW.width, GOLDEN_VIEW.height);
	const { buf, cells } = recordingBuffer(GOLDEN_VIEW.width, GOLDEN_VIEW.height);
	const particles = new ParticleEngine(seededRng(1));
	particles.step(0, activeZone(game.world, game.player.zoneId).terrain);

	drawPlayfield(buf, compositor, game, cam, {
		particles,
		dodges: new DodgeTracker(),
	});

	const chars = [...cells.values()].map((c) => c.char);
	// Pass 1: terrain.
	expect(
		[...cells.values()].some(
			(c) =>
				(c.char === '▄' || c.char === '█') &&
				c.fg.every((n, i) => n === TERRAIN_FG[i]),
		),
	).toBe(true);
	// Pass 5: the leftward projectile.
	expect(chars).toContain('◄');
	// Pass 7: the frontmost speech bubble owns its cells.
	expect(chars).toContain('╭');
	expect(chars).toContain('╯');
});

test('a native actor composes over terrain and reveals the composed backdrop, not a guess', () => {
	const compositor = new Compositor(24, 12);
	// Pass 1: a solid terrain field (opaque glyph stamps flatten to terrain bg).
	for (let y = 0; y < 12; y++)
		for (let x = 0; x < 24; x++)
			compositor.stampGlyph(x, y, '█', TERRAIN_FG, TERRAIN_BG);

	// Pass 3: a monster with transparent quadrants painted over the terrain.
	paintActor(compositor, entity({ id: 1, type: 'chaser', x: 8, y: 4 }), {
		x: 0,
		y: 0,
	});

	const surface = compositor.surface();
	let revealed = 0;
	for (const row of surface)
		for (const cell of row)
			if (
				cell.char !== '█' &&
				cell.char !== ' ' &&
				// The full-block stamp's remnant is its visible foreground colour.
				cell.bg.every((n, i) => n === TERRAIN_FG[i])
			)
				revealed++;
	// At least one partial-coverage actor cell shows the composed terrain beneath.
	expect(revealed).toBeGreaterThan(0);
});

test('a front stamp wins the cell and derives its backdrop from the composed underlay', () => {
	const compositor = new Compositor(1, 1);
	compositor.stampGlyph(0, 0, '█', TERRAIN_FG, TERRAIN_BG);
	// A later translucent combat glyph (pass 5) over pass-1 terrain: no authored
	// backdrop, so it derives one from the composed terrain beneath.
	compositor.stampGlyph(0, 0, '✦', [255, 245, 200, 255]);

	const cell = compositor.cell(0, 0);
	expect(cell.char).toBe('✦');
	// The backdrop is the terrain block's remnant — its visible foreground — not
	// a passed-in guess.
	expect([...cell.bg]).toEqual([...TERRAIN_FG]);
});
