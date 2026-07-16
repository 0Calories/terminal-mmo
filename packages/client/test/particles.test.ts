import { expect, test } from 'bun:test';
import type { Terrain } from '@mmo/core/entities';
import { isSolid, parseTerrain } from '@mmo/core/physics';
import { ParticleEngine } from '../src/particles';
import { EFFECTS } from '../src/particles/effects';
import {
	advanceSpecks,
	Pool,
	spawnSpeck,
	speckColor,
	speckDrawCell,
} from '../src/particles/engine';
import type { Profile, Speck } from '../src/particles/profile';
import { burstCount } from '../src/particles/profile';
import { seededRng } from './helpers';

const BLOOD = EFFECTS.blood.profile;
const GORE = EFFECTS.gore.profile;

function floorTerrain(w = 40, h = 20): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++) rows.push((y === h - 1 ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}

function wallTerrain(w = 40, h = 20, wallX = 25): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++) {
		const cells = Array.from({ length: w }, (_, x) =>
			y === h - 1 || x >= wallX ? '#' : '.',
		);
		rows.push(cells.join(''));
	}
	return parseTerrain(rows);
}

// A burst through the module-internal engine pieces — what the public
// named-effect spawn expands into.
function burst(
	pool: Pool,
	effect: keyof typeof EFFECTS,
	x: number,
	y: number,
	intensity: number,
	dir: -1 | 0 | 1,
	rng: () => number,
): void {
	const def = EFFECTS[effect];
	for (let i = 0; i < def.count(intensity); i++)
		spawnSpeck(pool, def.profile, x, y, dir, rng);
}

function speckAt(pool: Pool, i = 0): Speck {
	return pool.specks[i];
}

test('a blood burst through the named-effect door expands into specks', () => {
	const engine = new ParticleEngine(seededRng(1));
	engine.spawn('blood', { x: 5, y: 5 }, 1, 8);
	expect(engine.activeCount).toBeGreaterThan(0);
});

test('the level-up fountain is a non-colliding gold air burst of a fixed size (#271)', () => {
	const LEVELUP = EFFECTS.levelup.profile;
	expect(LEVELUP.collide).toBe(false);
	const born = LEVELUP.colors[0];
	expect(born.r).toBeGreaterThan(born.b);
	expect(born.g).toBeGreaterThan(born.b);
	// intensity does not change the fountain
	expect(EFFECTS.levelup.count(0)).toBe(EFFECTS.levelup.count(24));

	const engine = new ParticleEngine(seededRng(1));
	engine.spawn('levelup', { x: 10, y: 10 }, 0, 0);
	expect(engine.activeCount).toBe(EFFECTS.levelup.count(0));
	const terrain = floorTerrain();
	for (let i = 0; i < 80; i++) engine.step(16, terrain);
	expect(engine.activeCount).toBe(0);
});

test('bigger hits spawn visibly more specks, clamped to a sane range', () => {
	const count = EFFECTS.blood.count;
	expect(count(2)).toBeGreaterThanOrEqual(1);
	expect(count(40)).toBe(24);
	expect(count(0)).toBeGreaterThanOrEqual(1);
	expect(count(20)).toBeGreaterThan(count(4));
	expect(count(-5)).toBeGreaterThanOrEqual(1);
	expect(burstCount(40, 0.5)).toBe(12);
});

test('blood is bright red at birth, darkens with age, and fades to zero alpha', () => {
	const terrain = floorTerrain();
	const pool = new Pool(64);
	burst(pool, 'blood', 10, 16, 2, 1, seededRng(3));
	const p = speckAt(pool);
	const born = speckColor(p);
	expect(born.a).toBe(255);
	expect(born.r).toBeGreaterThan(born.g);
	expect(born.r).toBeGreaterThan(born.b);

	let fadeColor = born;
	for (let i = 0; i < 600 && p.active; i++) {
		advanceSpecks(pool, 16, terrain);
		if (p.stage === 'fade' && p.stageMs > 0) fadeColor = speckColor(p);
	}
	expect(fadeColor.r).toBeLessThan(born.r);
	expect(fadeColor.a).toBeLessThan(255);
});

test('a non-colliding spark fades smoothly to transparent over its life, not a pop at end (#264)', () => {
	expect(EFFECTS.impact.profile.collide).toBe(false);
	const terrain = floorTerrain();
	const pool = new Pool(64);
	burst(pool, 'impact', 10, 5, 4, 0, seededRng(3));
	const p = speckAt(pool);
	expect(p.active).toBe(true);
	expect(speckColor(p).a).toBe(255);

	let sawFullOpacity = false;
	let sawPartial = false;
	let minAlpha = 255;
	let lastAlpha = 255;
	let neverRoseWhileFading = true;
	for (let i = 0; i < 200 && p.active; i++) {
		const a = speckColor(p).a;
		if (a === 255) sawFullOpacity = true;
		if (a > 0 && a < 255) sawPartial = true;
		if (a < 255 && a > lastAlpha) neverRoseWhileFading = false;
		lastAlpha = a;
		minAlpha = Math.min(minAlpha, a);
		advanceSpecks(pool, 16, terrain);
	}
	expect(sawFullOpacity).toBe(true);
	expect(sawPartial).toBe(true);
	expect(neverRoseWhileFading).toBe(true);
	expect(minAlpha).toBeLessThan(32);
	expect(p.active).toBe(false);
});

test('gore is a meatier, chunkier profile — distinct glyphs, flies out further, fewer chunks', () => {
	expect(GORE).not.toBe(BLOOD);
	expect(GORE.launchSpeed).toBeGreaterThanOrEqual(BLOOD.launchSpeed);
	expect(GORE.glyphs.airborne).not.toEqual(BLOOD.glyphs.airborne);
	expect(EFFECTS.gore.count(24)).toBeLessThan(EFFECTS.blood.count(24));
});

test('a gore burst spawns fewer chunks than a blood spray of the same intensity', () => {
	const gore = new ParticleEngine(seededRng(1));
	const blood = new ParticleEngine(seededRng(1));
	gore.spawn('gore', { x: 5, y: 5 }, 0, 24);
	blood.spawn('blood', { x: 5, y: 5 }, 0, 24);
	expect(gore.activeCount).toBeLessThan(blood.activeCount);
});

test('a tinted gore burst colours its specks by the tint, not the maroon blood palette (#139)', () => {
	const pool = new Pool(64);
	const def = EFFECTS.gore;
	spawnSpeck(pool, def.profile, 10, 16, 0, seededRng(3), {
		r: 90,
		g: 170,
		b: 255,
	});
	const born = speckColor(speckAt(pool));
	expect(born.a).toBe(255);
	expect(born.b).toBeGreaterThan(born.r);
	expect(born.b).toBeGreaterThan(born.g);
});

test('a tinted speck keeps its hue but darkens with age', () => {
	const terrain = floorTerrain();
	const pool = new Pool(64);
	spawnSpeck(pool, EFFECTS.gore.profile, 10, 16, 0, seededRng(3), {
		r: 90,
		g: 170,
		b: 255,
	});
	const p = speckAt(pool);
	const born = speckColor(p);
	let aged = born;
	for (let i = 0; i < 600 && p.active; i++) {
		advanceSpecks(pool, 16, terrain);
		if (p.stage === 'fade' && p.stageMs > 0) aged = speckColor(p);
	}
	expect(aged.b).toBeGreaterThan(aged.r);
	expect(aged.b).toBeLessThan(born.b);
	expect(aged.a).toBeLessThan(255);
});

test('the pool is capped and never overflows', () => {
	const engine = new ParticleEngine(seededRng(1), 50);
	const terrain = floorTerrain();
	for (let i = 0; i < 100; i++) {
		engine.spawn('blood', { x: 5, y: 5 }, 1, 24);
		engine.step(16, terrain);
	}
	expect(engine.activeCount).toBeLessThanOrEqual(50);
});

test('when the pool is full the newest burst evicts the oldest specks', () => {
	const pool = new Pool(4);
	const rng = seededRng(7);
	burst(pool, 'blood', 5, 5, 2, 1, rng);
	burst(pool, 'blood', 5, 5, 2, 1, rng);
	const borns = pool.specks.filter((p) => p.active).map((p) => p.born);
	expect(pool.activeCount).toBe(4);
	const maxBorn = Math.max(...borns);
	// every survivor is among the newest `size` births — the oldest were evicted
	expect(Math.min(...borns)).toBeGreaterThan(maxBorn - 4);
});

test('a speck runs the full lifecycle: airborne → bounce → rest → fade → cull, landing on terrain', () => {
	const terrain = floorTerrain();
	const pool = new Pool(64);
	burst(pool, 'blood', 10, 16, 2, 1, seededRng(3));
	const p = speckAt(pool);
	expect(p.active).toBe(true);
	expect(p.stage).toBe('airborne');

	let sawBounce = false;
	let sawRest = false;
	let sawFade = false;
	let restY = -1;
	for (let i = 0; i < 600 && p.active; i++) {
		advanceSpecks(pool, 16, terrain);
		if (p.bounced) sawBounce = true;
		if (p.stage === 'rest') {
			sawRest = true;
			restY = p.y;
		}
		if (p.stage === 'fade') sawFade = true;
	}
	expect(sawBounce).toBe(true);
	expect(sawRest).toBe(true);
	expect(sawFade).toBe(true);
	expect(p.active).toBe(false);
	// rests in the empty cell just above the surface, never inside it
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY))).toBe(false);
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY) + 1)).toBe(true);
});

test('a falling speck resolves through the shared sweep and never penetrates the ground', () => {
	// tall arena so a speck exceeds 1 cell/frame and would tunnel without swept collision
	const terrain = floorTerrain(40, 80);
	const pool = new Pool(64);
	burst(pool, 'blood', 10, 2, 24, 1, seededRng(5));
	for (let i = 0; i < 800; i++) {
		advanceSpecks(pool, 16, terrain);
		for (const p of pool.specks) {
			if (!p.active) continue;
			const col = Math.floor(p.x);
			if (col < 0 || col >= terrain.w) continue;
			expect(isSolid(terrain, col, Math.floor(p.y))).toBe(false);
		}
	}
});

test('specks spraying sideways into a wall never embed in the solid terrain', () => {
	const terrain = wallTerrain(40, 20, 25);
	const pool = new Pool(64);
	burst(pool, 'blood', 23, 10, 24, 1, seededRng(8));
	for (let i = 0; i < 400; i++) {
		advanceSpecks(pool, 16, terrain);
		for (const p of pool.specks) {
			if (!p.active) continue;
			const cx = Math.floor(p.x);
			if (cx < 0 || cx >= terrain.w) continue;
			expect(isSolid(terrain, cx, Math.floor(p.y))).toBe(false);
		}
	}
});

function speck(over: Partial<Speck>): Speck {
	return {
		active: true,
		profile: BLOOD,
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

test('a colliding speck draws floor-aligned in its own sim cell — never rounded into the floor', () => {
	// y=18.6 keeps the sim cell (18) empty, but the old round() draw sank it into the floor at 19
	const terrain = floorTerrain(40, 20);
	const p = speck({ x: 10, y: 18.6 });
	expect(isSolid(terrain, 10, Math.round(p.y))).toBe(true);
	const { col, row } = speckDrawCell(p, terrain);
	expect(col).toBe(10);
	expect(row).toBe(18);
	expect(isSolid(terrain, col, row)).toBe(false);
});

test('a wall-adjacent speck draws floor-aligned in the empty column — never rounded into the wall tile', () => {
	// x=24.6 keeps the sim column (24) empty, but the old round() draw painted it into the wall at 25
	const terrain = wallTerrain(40, 20, 25);
	const p = speck({ x: 24.6, y: 10 });
	expect(isSolid(terrain, Math.round(p.x), 10)).toBe(true);
	const { col, row } = speckDrawCell(p, terrain);
	expect(col).toBe(24);
	expect(row).toBe(10);
	expect(isSolid(terrain, col, row)).toBe(false);
});

test('a non-colliding spark keeps the nearest-cell projection', () => {
	const terrain = floorTerrain(40, 20);
	const p = speck({ profile: EFFECTS.impact.profile, x: 10.6, y: 5.6 });
	expect(speckDrawCell(p, terrain)).toEqual({ col: 11, row: 6 });
});

test('a settled speck draws flush IN the `▄` surface cell, on the visible ground line (#264)', () => {
	// a top-surface solid renders as a lower-half `▄`, so a settled speck draws into that cell, not the empty one above
	const terrain = floorTerrain(40, 20);
	const pool = new Pool(64);
	burst(pool, 'blood', 10, 16, 4, 1, seededRng(3));
	let settled: Speck | undefined;
	for (let i = 0; i < 600 && !settled; i++) {
		advanceSpecks(pool, 16, terrain);
		settled = pool.specks.find(
			(p) => p.active && (p.stage === 'rest' || p.stage === 'fade'),
		);
	}
	expect(settled).toBeDefined();
	const p = settled as Speck;
	expect(isSolid(terrain, Math.floor(p.x), Math.floor(p.y))).toBe(false);
	const { col, row } = speckDrawCell(p, terrain);
	expect(isSolid(terrain, col, row)).toBe(true);
	expect(isSolid(terrain, col, row - 1)).toBe(false);
	expect(row).toBe(Math.floor(p.y) + 1);
});

test('a colliding speck whose own cell is solid dies instead of resting', () => {
	const terrain = floorTerrain(40, 20);
	const pool = new Pool(4);
	// planted inside the floor — the backstop for anything that ever embeds
	spawnSpeck(pool, BLOOD, 10, 19.5, 0, seededRng(1));
	expect(pool.activeCount).toBe(1);
	advanceSpecks(pool, 16, terrain);
	expect(pool.activeCount).toBe(0);
});

test('a descending speck lands on a one-way platform top; an ascending one passes through', () => {
	// platform row at y=10 with open air above and below
	const rows: string[] = [];
	for (let y = 0; y < 20; y++)
		rows.push(y === 10 ? '='.repeat(40) : (y === 19 ? '#' : '.').repeat(40));
	const terrain = parseTerrain(rows);

	const pool = new Pool(4);
	// falling from above: lands on the platform, never below it
	spawnSpeck(pool, BLOOD, 10, 5, 0, seededRng(1));
	const faller = speckAt(pool);
	faller.vx = 0;
	faller.vy = 4;
	for (let i = 0; i < 400 && faller.stage === 'airborne'; i++)
		advanceSpecks(pool, 16, terrain);
	expect(faller.stage).toBe('rest');
	expect(Math.floor(faller.y)).toBe(9);

	// rising from below: passes straight through the platform row
	const up = new Pool(4);
	spawnSpeck(up, BLOOD, 10, 12, 0, seededRng(1));
	const riser = speckAt(up);
	riser.vx = 0;
	riser.vy = -30;
	let crossed = false;
	for (let i = 0; i < 60; i++) {
		advanceSpecks(up, 16, terrain);
		if (riser.y < 10) crossed = true;
	}
	expect(crossed).toBe(true);
});

test('a profile with no gravity and no terrain collision never settles (profile-driven)', () => {
	const FLOATER: Profile = {
		...BLOOD,
		gravity: 0,
		collide: false,
		launchSpeed: 0,
		launchSpread: 0,
	};
	const terrain = floorTerrain();
	const pool = new Pool(4);
	spawnSpeck(pool, FLOATER, 10, 16, 1, seededRng(3));
	const p = speckAt(pool);
	for (let i = 0; i < 300; i++) advanceSpecks(pool, 16, terrain);
	expect(p.stage).toBe('airborne');
	expect(p.bounced).toBe(false);
});

test('the burst size tracks the effect intensity', () => {
	const big = new ParticleEngine(seededRng(1));
	const small = new ParticleEngine(seededRng(1));
	big.spawn('blood', { x: 5, y: 5 }, 1, 24);
	small.spawn('blood', { x: 5, y: 5 }, 1, 2);
	expect(big.activeCount).toBeGreaterThan(small.activeCount);
});
