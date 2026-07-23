import { expect, test } from 'bun:test';
import { Compositor } from '@mmo/render/compositor';
import { ParticleEngine, type ParticleLayer } from '../src/particles';
import { drawSpecks } from '../src/particles/draw';
import { EFFECTS } from '../src/particles/effects';
import { speckGlyph } from '../src/particles/engine';
import type { Speck } from '../src/particles/profile';
import { flatTerrain, seededRng } from './helpers';

const SEED = 0xfacade;
const W = 64;
const H = 24;
const DT = 16;

const CAM = { x: 0, y: 0 };

/** A cell the compositor did not touch — empty space stays fully transparent. */
function isEmpty(cell: { char: string; bg: readonly number[] }): boolean {
	return cell.char === ' ' && cell.bg[3] === 0;
}

/** Cells a layer's specks composed into an otherwise empty scene. */
function painted(engine: ParticleEngine, layer: ParticleLayer): number {
	const compositor = new Compositor(W, H);
	engine.draw(compositor, CAM, layer);
	let n = 0;
	for (const row of compositor.surface())
		for (const cell of row) if (!isEmpty(cell)) n++;
	return n;
}

function baseSpeck(over: Partial<Speck>): Speck {
	return {
		active: true,
		profile: EFFECTS.blood.profile,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		stage: 'airborne',
		bounced: false,
		ageMs: 0,
		stageMs: 0,
		born: 0,
		seed: 0,
		...over,
	};
}

test('a blood spawn realizes into airborne specks; nothing has settled yet', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(W, H));

	expect(painted(engine, 'airborne')).toBeGreaterThan(0);
	expect(painted(engine, 'settled')).toBe(0);
});

test('settled blood moves from the airborne layer to the settled layer', () => {
	const terrain = flatTerrain(W, H);
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 20 }, 1, 8);
	for (let i = 0; i < 200; i++) engine.step(DT, terrain);

	expect(painted(engine, 'settled')).toBeGreaterThan(0);
});

test('nothing draws before the first step supplies terrain', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);

	expect(painted(engine, 'airborne')).toBe(0);
});

test('a level-up burst needs no CombatEvent: the levelup effect is a spawn door of its own', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.step(DT, flatTerrain(W, H));
	expect(painted(engine, 'airborne')).toBe(0);

	engine.spawn('levelup', { x: 20, y: 12 }, 0, 0);
	engine.step(DT, flatTerrain(W, H));
	expect(painted(engine, 'airborne')).toBeGreaterThan(0);
});

test('clear drops every live speck from both render layers', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 10, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(W, H));
	expect(engine.activeCount).toBeGreaterThan(0);

	engine.clear();
	expect(engine.activeCount).toBe(0);
	expect(painted(engine, 'airborne')).toBe(0);
	expect(painted(engine, 'settled')).toBe(0);
});

test('an off-screen speck is clipped from the draw, not from the sim', () => {
	const engine = new ParticleEngine(seededRng(SEED));
	engine.spawn('blood', { x: 200, y: 10 }, 1, 8);
	engine.step(DT, flatTerrain(400, H));

	expect(engine.activeCount).toBeGreaterThan(0);
	expect(painted(engine, 'airborne')).toBe(0);
});

test('a Pixel-profile speck composes as a translucent sub-cell pixel, revealing the scene beneath', () => {
	expect(EFFECTS.blood.profile.primitive).toBe('pixel');
	const compositor = new Compositor(1, 1);
	const terrainBg: [number, number, number, number] = [30, 30, 30, 255];
	// A composed backdrop fills the whole cell (pass 1/2 underlay).
	compositor.fillPixelRect(0, 0, 2, 2, terrainBg);

	// A fading blood speck — translucent so its pixel blends, not overwrites.
	const p = baseSpeck({
		stage: 'fade',
		stageMs: 375,
		ageMs: 0,
		x: 0.5,
		y: 0.5,
	});
	drawSpecks(compositor, [p], CAM, flatTerrain(4, 4), () => true);

	const cell = compositor.cell(0, 0);
	// Sub-cell coverage: a quadrant glyph, not a solid overwrite of the cell.
	expect(cell.char).not.toBe(' ');
	expect(cell.char).not.toBe('█');
	// Foreground is the blood blended over terrain (between the two), not pure red.
	expect(cell.fg[0]).toBeGreaterThan(terrainBg[0]);
	expect(cell.fg[0]).toBeLessThan(220);
	// The backdrop still reveals the composed terrain, not a black box.
	expect([...cell.bg]).toEqual(terrainBg);
});

test('a Glyph-profile speck stamps its char snapped to a cell, deriving the real backdrop', () => {
	expect(EFFECTS.impact.profile.primitive).toBe('glyph');
	const compositor = new Compositor(1, 1);
	const terrainBg: [number, number, number, number] = [20, 40, 20, 255];
	compositor.fillPixelRect(0, 0, 2, 2, terrainBg);

	const p = baseSpeck({
		profile: EFFECTS.impact.profile,
		stage: 'airborne',
		seed: 0,
		x: 0,
		y: 0,
	});
	drawSpecks(compositor, [p], CAM, flatTerrain(4, 4), () => true);

	const cell = compositor.cell(0, 0);
	expect(cell.char).toBe(speckGlyph(p));
	// No authored bg: the glyph derives its backdrop from the composed terrain.
	expect([...cell.bg]).toEqual(terrainBg);
});

test('settled specks compose behind actors; airborne specks compose above actors and below labels', () => {
	// Mirrors scene.ts pass order: pass 2 settled → pass 3/4 actors → pass 5
	// airborne → pass 6 labels.
	const terrain = flatTerrain(4, 4);
	const actorFg: [number, number, number, number] = [200, 200, 200, 255];
	const actorBg: [number, number, number, number] = [10, 10, 10, 255];

	const behind = new Compositor(1, 1);
	const settled = baseSpeck({ stage: 'rest', x: 0.5, y: 0.5 });
	drawSpecks(behind, [settled], CAM, terrain, () => true);
	behind.stampGlyph(0, 0, 'M', actorFg, actorBg);
	// The actor drawn after the settled speck occludes it.
	expect(behind.cell(0, 0).char).toBe('M');

	const front = new Compositor(1, 1);
	front.stampGlyph(0, 0, 'M', actorFg, actorBg);
	const airborne = baseSpeck({
		profile: EFFECTS.impact.profile,
		stage: 'airborne',
		x: 0,
		y: 0,
	});
	drawSpecks(front, [airborne], CAM, terrain, () => true);
	// The airborne speck drawn after the actor shows in front of it.
	expect(front.cell(0, 0).char).toBe(speckGlyph(airborne));
	// A later label (pass 6) still wins over the airborne particle.
	front.stampGlyph(0, 0, 'x', [255, 255, 255, 255]);
	expect(front.cell(0, 0).char).toBe('x');
});

test('the same seed composes the same specks — determinism survives the compositor', () => {
	const terrain = flatTerrain(W, H);
	function surfaceFor(): string {
		const engine = new ParticleEngine(seededRng(SEED));
		engine.spawn('blood', { x: 10, y: 12 }, 1, 12);
		engine.spawn('impact', { x: 30, y: 8 }, 0, 6);
		for (let i = 0; i < 8; i++) engine.step(DT, terrain);
		const compositor = new Compositor(W, H);
		engine.draw(compositor, CAM, 'settled');
		engine.draw(compositor, CAM, 'airborne');
		return JSON.stringify(compositor.surface());
	}
	expect(surfaceFor()).toBe(surfaceFor());
});
