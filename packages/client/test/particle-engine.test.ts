import { expect, test } from 'bun:test';
import type { OptimizedBuffer } from '@opentui/core';
import { ParticleEngine, type ParticleLayer } from '../src/particles';
import { flatTerrain, seededRng } from './helpers';

// The engine's public surface: named-effect spawns in, layered draws out.

const SEED = 0xfacade;
const W = 64;
const H = 24;
const DT = 16;

// The engine draws through OptimizedBuffer's blending call; recording it is
// enough to know which layer painted where.
function stubBuffer(w = W, h = H) {
	const cells: { x: number; y: number; ch: string }[] = [];
	const buf = {
		width: w,
		height: h,
		setCellWithAlphaBlending(x: number, y: number, ch: string) {
			cells.push({ x, y, ch });
		},
	};
	return { buf: buf as unknown as OptimizedBuffer, cells };
}

function drawn(engine: ParticleEngine, layer: ParticleLayer) {
	const { buf, cells } = stubBuffer();
	engine.draw(buf, { x: 0, y: 0 }, layer);
	return cells;
}

test('a blood spawn realizes into airborne specks; nothing has settled yet', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(W, H));

	expect(drawn(engine, 'airborne').length).toBeGreaterThan(0);
	expect(drawn(engine, 'settled').length).toBe(0);
});

test('settled blood moves from the airborne layer to the settled layer', () => {
	const terrain = flatTerrain(W, H);
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 20 }, 1, 8);
	for (let i = 0; i < 200; i++) engine.step(DT, terrain);

	expect(drawn(engine, 'settled').length).toBeGreaterThan(0);
});

test('nothing draws before the first step supplies terrain', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);

	expect(drawn(engine, 'airborne').length).toBe(0);
});

test('a level-up burst needs no CombatEvent: the levelup effect is a spawn door of its own', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.step(DT, flatTerrain(W, H));
	expect(drawn(engine, 'airborne').length).toBe(0);

	engine.spawn('levelup', { x: 20, y: 12 }, 0, 0);
	engine.step(DT, flatTerrain(W, H));
	expect(drawn(engine, 'airborne').length).toBeGreaterThan(0);
});

test('clear() drops every live speck — the zone-change reset (#373)', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(W, H));
	expect(engine.activeCount).toBeGreaterThan(0);

	engine.clear();
	expect(engine.activeCount).toBe(0);
	expect(drawn(engine, 'airborne').length).toBe(0);
	expect(drawn(engine, 'settled').length).toBe(0);
});

test('an off-screen speck is clipped from the draw, not from the sim', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 200, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(400, H));

	expect(engine.activeCount).toBeGreaterThan(0);
	expect(drawn(engine, 'airborne').length).toBe(0);
});
