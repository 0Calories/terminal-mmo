import { expect, test } from 'bun:test';
import { quadrantsFromGlyph } from '@mmo/render';
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
	drawSpecks(compositor, [p], CAM, () => true);

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
	drawSpecks(compositor, [p], CAM, () => true);

	const cell = compositor.cell(0, 0);
	expect(cell.char).toBe(speckGlyph(p));
	// No authored bg: the glyph derives its backdrop from the composed terrain.
	expect([...cell.bg]).toEqual(terrainBg);
});

test('settled specks compose behind actors; airborne specks compose above actors and below labels', () => {
	// Mirrors scene.ts pass order: pass 2 settled → pass 3/4 actors → pass 5
	// airborne → pass 6 labels.
	const actorFg: [number, number, number, number] = [200, 200, 200, 255];
	const actorBg: [number, number, number, number] = [10, 10, 10, 255];

	const behind = new Compositor(1, 1);
	const settled = baseSpeck({ stage: 'rest', x: 0.5, y: 0.5 });
	drawSpecks(behind, [settled], CAM, () => true);
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
	drawSpecks(front, [airborne], CAM, () => true);
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

// --- #453: half-cell Pixel placement and cell-snapped Glyph placement ---

const FIELD = 16;

function nonEmpty(compositor: Compositor): number {
	let n = 0;
	for (const row of compositor.surface())
		for (const cell of row) if (!isEmpty(cell)) n++;
	return n;
}

/** The single sub-cell Pixel a lone opaque Pixel speck composed, in Pixel coords. */
function paintedPixel(compositor: Compositor): { px: number; py: number } {
	let found: { px: number; py: number } | null = null;
	for (let cy = 0; cy < compositor.heightCells; cy++) {
		for (let cx = 0; cx < compositor.widthCells; cx++) {
			const cell = compositor.cell(cx, cy);
			if (isEmpty(cell)) continue;
			const mask = quadrantsFromGlyph(cell.char);
			if (mask === undefined)
				throw new Error(`not a quadrant glyph: ${cell.char}`);
			for (let bit = 0; bit < 4; bit++) {
				if (!(mask & (1 << bit))) continue;
				if (found) throw new Error('expected exactly one Pixel');
				found = { px: cx * 2 + (bit % 2), py: cy * 2 + (bit >> 1) };
			}
		}
	}
	if (!found) throw new Error('no Pixel composed');
	return found;
}

function pixelAt(
	x: number,
	y: number,
	cam = CAM,
	over: Partial<Speck> = {},
): { px: number; py: number } {
	const compositor = new Compositor(FIELD, FIELD);
	drawSpecks(compositor, [baseSpeck({ x, y, ...over })], cam, () => true);
	return paintedPixel(compositor);
}

/** The cell a lone Glyph speck stamped, plus its char. */
function glyphCell(
	x: number,
	y: number,
	cam = CAM,
): { col: number; row: number; char: string } {
	const compositor = new Compositor(FIELD, FIELD);
	const p = baseSpeck({ profile: EFFECTS.impact.profile, x, y, seed: 0 });
	drawSpecks(compositor, [p], cam, () => true);
	const rows = compositor.surface();
	for (let row = 0; row < rows.length; row++)
		for (let col = 0; col < rows[row].length; col++)
			if (!isEmpty(rows[row][col]))
				return { col, row, char: rows[row][col].char };
	throw new Error('no Glyph stamped');
}

test('a Pixel speck follows its half-cell position: half a cell shifts one sub-Pixel, a full cell shifts two, on both axes', () => {
	const base = pixelAt(4, 4);
	expect(pixelAt(4.5, 4)).toEqual({ px: base.px + 1, py: base.py });
	expect(pixelAt(5, 4)).toEqual({ px: base.px + 2, py: base.py });
	expect(pixelAt(4, 4.5)).toEqual({ px: base.px, py: base.py + 1 });
	expect(pixelAt(4, 5)).toEqual({ px: base.px, py: base.py + 2 });
});

test('a Pixel speck quantizes the combined world-relative transform once — no shimmer against a half-cell camera', () => {
	const cam = { x: 0.5, y: 0.5 };
	// A stationary speck under a fixed half-cell camera is identical frame to frame.
	expect(pixelAt(5.3, 4.2, cam)).toEqual(pixelAt(5.3, 4.2, cam));
	// Speck and camera nudged by the same sub-cell delta keep the same screen Pixel.
	const d = 0.5;
	expect(pixelAt(5.3 + d, 4.2 + d, { x: cam.x + d, y: cam.y + d })).toEqual(
		pixelAt(5.3, 4.2, cam),
	);
});

test('a settled Pixel speck rests on the terrain surface at sub-cell precision', () => {
	const surfaceRow = 6;
	// Physics settles a speck just above the solid face: y = surfaceRow - eps.
	const restY = surfaceRow - 1e-3;
	const onSurfacePy = surfaceRow * 2; // top Pixel row of the surface cell
	const rest = { stage: 'rest' as const };
	expect(pixelAt(4.2, restY, CAM, rest).py).toBe(onSurfacePy);
	// A half-cell horizontal move shifts one sub-Pixel but stays on the surface.
	const a = pixelAt(4.2, restY, CAM, rest);
	const b = pixelAt(4.7, restY, CAM, rest);
	expect(b.px).toBe(a.px + 1);
	expect(b.py).toBe(onSurfacePy);
});

test('a Glyph speck snaps deterministically to the nearest cell — ties never flicker', () => {
	expect(glyphCell(3.4, 2.4)).toMatchObject({ col: 3, row: 2 });
	expect(glyphCell(3.6, 2.6)).toMatchObject({ col: 4, row: 3 });
	// A dead-centre speck resolves to the same cell every frame.
	const tie1 = glyphCell(3.5, 2.5);
	const tie2 = glyphCell(3.5, 2.5);
	expect(tie1).toEqual(tie2);
	expect(tie1).toMatchObject({ col: 4, row: 3 });
});

test('an off-screen speck composes nothing and leaves an on-screen neighbour intact', () => {
	const gone = new Compositor(FIELD, FIELD);
	drawSpecks(gone, [baseSpeck({ x: 500, y: 4 })], CAM, () => true);
	expect(nonEmpty(gone)).toBe(0);

	const mixed = new Compositor(FIELD, FIELD);
	drawSpecks(
		mixed,
		[baseSpeck({ x: 4, y: 4 }), baseSpeck({ x: -80, y: 4 })],
		CAM,
		() => true,
	);
	expect(nonEmpty(mixed)).toBe(1);
	expect(paintedPixel(mixed)).toEqual({ px: 8, py: 8 });
});
