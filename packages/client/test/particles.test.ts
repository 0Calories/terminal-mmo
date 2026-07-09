import { expect, test } from 'bun:test';
import type { Effect, EffectKind, Terrain } from '@mmo/core';
import { isSolid, parseTerrain } from '@mmo/core';
import {
	advanceParticles,
	type Particle,
	ParticleSystem,
	type ParticleType,
	particleColor,
	particleDrawRow,
} from '../src/effects/particles';
import {
	BLOOD,
	type Camera,
	GORE,
	IMPACT,
	LEVELUP,
	LEVELUP_SPECKS,
	REALIZE,
	type Realization,
	spawnEffects,
	speckCount,
} from '../src/effects/realize';

// The adapter spawn + engine advance the facade composes each frame.
function stepParticles(
	sys: ParticleSystem,
	effects: readonly Effect[],
	dtMs: number,
	terrain: Terrain,
	rng: () => number,
	cam?: Camera,
	realize?: Record<EffectKind, Realization>,
): void {
	spawnEffects(sys, effects, rng, cam, realize);
	advanceParticles(sys, dtMs, terrain);
}

function seededRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

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

function bloodAt(
	x: number,
	y: number,
	intensity = 8,
	dir: -1 | 0 | 1 = 1,
): Effect {
	return { kind: 'blood', x, y, intensity, dir };
}

test('a blood Effect expands into a burst of specks', () => {
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(5, 5)], 16, floorTerrain(), seededRng(1));
	expect(sys.activeCount).toBeGreaterThan(0);
});

test('the level-up fountain is a non-colliding gold air burst spawned straight into the pool (#271)', () => {
	expect(LEVELUP.collide).toBe(false);
	const born = LEVELUP.colors[0];
	expect(born.r).toBeGreaterThan(born.b);
	expect(born.g).toBeGreaterThan(born.b);

	const sys = new ParticleSystem();
	for (let i = 0; i < LEVELUP_SPECKS; i++)
		sys.spawn(LEVELUP, 10, 10, 0, seededRng(i + 1));
	expect(sys.activeCount).toBe(LEVELUP_SPECKS);
	const terrain = floorTerrain();
	for (let i = 0; i < 80; i++)
		stepParticles(sys, [], 16, terrain, seededRng(7));
	expect(sys.activeCount).toBe(0);
});

test('bigger hits spawn visibly more specks, clamped to a sane range', () => {
	expect(speckCount(2)).toBeGreaterThanOrEqual(1);
	expect(speckCount(40)).toBe(24);
	expect(speckCount(0)).toBeGreaterThanOrEqual(1);
	expect(speckCount(20)).toBeGreaterThan(speckCount(4));
	expect(speckCount(-5)).toBeGreaterThanOrEqual(1);
});

test('blood is bright red at birth, darkens with age, and fades to zero alpha', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 16, 2)], 16, terrain, seededRng(3));
	const p = sys.particles[0];
	const born = particleColor(p);
	expect(born.a).toBe(255);
	expect(born.r).toBeGreaterThan(born.g);
	expect(born.r).toBeGreaterThan(born.b);

	let fadeColor = born;
	for (let i = 0; i < 600 && p.active; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(99));
		if (p.stage === 'fade' && p.stageMs > 0) fadeColor = particleColor(p);
	}
	expect(fadeColor.r).toBeLessThan(born.r);
	expect(fadeColor.a).toBeLessThan(255);
});

test('a non-colliding spark fades smoothly to transparent over its life, not a pop at end (#264)', () => {
	expect(IMPACT.collide).toBe(false);
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	stepParticles(
		sys,
		[{ kind: 'impact', x: 10, y: 5, intensity: 4, dir: 0 }],
		16,
		terrain,
		seededRng(3),
	);
	const p = sys.particles[0];
	expect(p.active).toBe(true);
	expect(particleColor(p).a).toBe(255);

	let sawFullOpacity = false;
	let sawPartial = false;
	let minAlpha = 255;
	let lastAlpha = 255;
	let neverRoseWhileFading = true;
	for (let i = 0; i < 200 && p.active; i++) {
		const a = particleColor(p).a;
		if (a === 255) sawFullOpacity = true;
		if (a > 0 && a < 255) sawPartial = true;
		if (a < 255 && a > lastAlpha) neverRoseWhileFading = false;
		lastAlpha = a;
		minAlpha = Math.min(minAlpha, a);
		stepParticles(sys, [], 16, terrain, seededRng(99));
	}
	expect(sawFullOpacity).toBe(true);
	expect(sawPartial).toBe(true);
	expect(neverRoseWhileFading).toBe(true);
	expect(minAlpha).toBeLessThan(32);
	expect(p.active).toBe(false);
});

test('the Effect.kind → ParticleType map routes blood to the blood profile', () => {
	expect(REALIZE.blood.particles).toContain(BLOOD);
});

test('the Effect.kind → ParticleType map routes gore (death) to the gore profile', () => {
	expect(REALIZE.gore.particles).toContain(GORE);
});

test('gore is a meatier, chunkier profile — distinct glyphs, flies out further, fewer chunks', () => {
	expect(GORE).not.toBe(BLOOD);
	expect(GORE.launchSpeed).toBeGreaterThanOrEqual(BLOOD.launchSpeed);
	expect(GORE.glyphs.airborne).not.toEqual(BLOOD.glyphs.airborne);
	expect(GORE.countScale).toBeLessThan(1);
});

test('a gore burst spawns fewer chunks than a blood spray of the same intensity', () => {
	const gore = new ParticleSystem();
	const blood = new ParticleSystem();
	const at = (kind: EffectKind): Effect => ({
		kind,
		x: 5,
		y: 5,
		intensity: 24,
		dir: 0,
	});
	stepParticles(gore, [at('gore')], 16, floorTerrain(), seededRng(1));
	stepParticles(blood, [at('blood')], 16, floorTerrain(), seededRng(1));
	expect(gore.activeCount).toBeLessThan(blood.activeCount);
});

test('a tinted gore Effect colours its specks by the tint, not the maroon blood palette (#139)', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	const fx: Effect = {
		kind: 'gore',
		x: 10,
		y: 16,
		intensity: 4,
		dir: 0,
		tint: { r: 90, g: 170, b: 255 },
	};
	stepParticles(sys, [fx], 16, terrain, seededRng(3));
	const p = sys.particles[0];
	const born = particleColor(p);
	expect(born.a).toBe(255);
	expect(born.b).toBeGreaterThan(born.r);
	expect(born.b).toBeGreaterThan(born.g);
});

test('a tinted speck keeps its hue but darkens with age', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	const fx: Effect = {
		kind: 'gore',
		x: 10,
		y: 16,
		intensity: 2,
		dir: 0,
		tint: { r: 90, g: 170, b: 255 },
	};
	stepParticles(sys, [fx], 16, terrain, seededRng(3));
	const p = sys.particles[0];
	const born = particleColor(p);
	let aged = born;
	for (let i = 0; i < 600 && p.active; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(99));
		if (p.stage === 'fade' && p.stageMs > 0) aged = particleColor(p);
	}
	expect(aged.b).toBeGreaterThan(aged.r);
	expect(aged.b).toBeLessThan(born.b);
	expect(aged.a).toBeLessThan(255);
});

test('the pool is capped and never overflows', () => {
	const sys = new ParticleSystem(50);
	const rng = seededRng(1);
	for (let i = 0; i < 100; i++)
		stepParticles(sys, [bloodAt(5, 5, 24)], 16, floorTerrain(), rng);
	expect(sys.activeCount).toBeLessThanOrEqual(50);
});

test('when the pool is full the newest burst evicts the oldest specks', () => {
	const sys = new ParticleSystem(4);
	const rng = seededRng(7);
	stepParticles(sys, [bloodAt(5, 5, 2)], 16, floorTerrain(), rng);
	stepParticles(sys, [bloodAt(5, 5, 2)], 16, floorTerrain(), rng);
	const borns = sys.particles.filter((p) => p.active).map((p) => p.born);
	expect(sys.activeCount).toBe(4);
	const maxBorn = Math.max(...borns);
	// every survivor is among the newest `size` births — the oldest were evicted
	expect(Math.min(...borns)).toBeGreaterThan(maxBorn - 4);
});

test('a speck runs the full lifecycle: airborne → bounce → rest → fade → cull, landing on terrain', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 16, 2)], 16, terrain, seededRng(3));
	const p = sys.particles[0];
	expect(p.active).toBe(true);
	expect(p.stage).toBe('airborne');

	let sawBounce = false;
	let sawRest = false;
	let sawFade = false;
	let restY = -1;
	for (let i = 0; i < 600 && p.active; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(99));
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
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY))).toBe(false);
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY) + 1)).toBe(true);
});

test('a falling speck collides with the surface and never penetrates the ground', () => {
	// tall arena so a speck exceeds 1 cell/frame and would tunnel without swept collision
	const terrain = floorTerrain(40, 80);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 2, 24)], 16, terrain, seededRng(5));
	for (let i = 0; i < 800; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(13));
		for (const p of sys.particles) {
			if (!p.active) continue;
			const col = Math.floor(p.x);
			if (col < 0 || col >= terrain.w) continue;
			expect(isSolid(terrain, col, Math.floor(p.y))).toBe(false);
		}
	}
});

test('specks spraying sideways into a wall never embed in the solid terrain', () => {
	const terrain = wallTerrain(40, 20, 25);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(23, 10, 24, 1)], 16, terrain, seededRng(8));
	for (let i = 0; i < 400; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(21));
		for (const p of sys.particles) {
			if (!p.active) continue;
			const cx = Math.floor(p.x);
			if (cx < 0 || cx >= terrain.w) continue;
			expect(isSolid(terrain, cx, Math.floor(p.y))).toBe(false);
		}
	}
});

test('the draw row biases up out of a solid cell when rounding would sink a near-surface speck', () => {
	// y=18.6 keeps the physics cell (18) empty, but Math.round→19 sinks the draw cell into the floor
	const terrain = floorTerrain(40, 20);
	const sunk: Particle = {
		active: true,
		type: BLOOD,
		x: 10,
		y: 18.6,
		vx: 0,
		vy: 0,
		stage: 'airborne',
		bounced: false,
		ageMs: 0,
		stageMs: 0,
		born: 0,
		seed: 0,
	};
	const col = Math.round(sunk.x);
	expect(isSolid(terrain, col, Math.round(sunk.y))).toBe(true);
	const row = particleDrawRow(sunk, terrain, col, Math.round(sunk.y));
	expect(isSolid(terrain, col, row)).toBe(false);
	expect(row).toBe(18);
});

test('the draw row is a no-op when the rounded cell is already empty', () => {
	const terrain = floorTerrain(40, 20);
	const airborne: Particle = {
		active: true,
		type: BLOOD,
		x: 10,
		y: 5.4,
		vx: 0,
		vy: 0,
		stage: 'airborne',
		bounced: false,
		ageMs: 0,
		stageMs: 0,
		born: 0,
		seed: 0,
	};
	const col = Math.round(airborne.x);
	const row = particleDrawRow(airborne, terrain, col, Math.round(airborne.y));
	expect(row).toBe(Math.round(airborne.y));
});

test('no active in-bounds AIRBORNE speck ever DRAWS inside a solid cell over a real burst', () => {
	const terrain = floorTerrain(40, 24);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 18, 24)], 16, terrain, seededRng(5));
	let rawWouldSink = false;
	for (let i = 0; i < 400; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(17));
		for (const p of sys.particles) {
			if (!p.active || p.stage !== 'airborne') continue;
			const col = Math.round(p.x);
			if (col < 0 || col >= terrain.w) continue;
			const rawRow = Math.round(p.y);
			if (isSolid(terrain, col, rawRow)) rawWouldSink = true;
			const row = particleDrawRow(p, terrain, col, rawRow);
			expect(isSolid(terrain, col, row)).toBe(false);
		}
	}
	// rawWouldSink guards a vacuous pass: the raw projection really would have sunk
	expect(rawWouldSink).toBe(true);
});

test('a settled speck draws flush IN the `▄` surface cell, on the visible ground line (#264)', () => {
	// a top-surface solid renders as a lower-half `▄`, so a settled speck draws into that cell, not the empty one above
	const terrain = floorTerrain(40, 20);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 16, 4)], 16, terrain, seededRng(3));
	let settled: Particle | undefined;
	for (let i = 0; i < 600 && !settled; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(99));
		settled = sys.particles.find(
			(p) => p.active && (p.stage === 'rest' || p.stage === 'fade'),
		);
	}
	expect(settled).toBeDefined();
	const p = settled as Particle;
	const col = Math.round(p.x);
	expect(isSolid(terrain, col, Math.floor(p.y))).toBe(false);
	const rawRow = Math.round(p.y);
	const drawRow = particleDrawRow(p, terrain, col, rawRow);
	expect(isSolid(terrain, col, drawRow)).toBe(true);
	expect(isSolid(terrain, col, drawRow - 1)).toBe(false);
	expect(drawRow).toBe(rawRow + 1);
});

test('a profile with no gravity and no terrain collision never settles (profile-driven)', () => {
	const FLOATER: ParticleType = {
		...BLOOD,
		gravity: 0,
		collide: false,
		launchSpeed: 0,
		launchSpread: 0,
	};
	const float: Realization = {
		particles: [FLOATER],
		kick: false,
		hitstop: false,
	};
	const map: Record<EffectKind, Realization> = {
		blood: float,
		gore: float,
		impact: float,
	};
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	stepParticles(
		sys,
		[bloodAt(10, 16, 2)],
		16,
		terrain,
		seededRng(3),
		undefined,
		map,
	);
	const p = sys.particles[0];
	for (let i = 0; i < 300; i++)
		stepParticles(sys, [], 16, terrain, seededRng(99), undefined, map);
	expect(p.stage).toBe('airborne');
	expect(p.bounced).toBe(false);
});

test('an off-camera Effect is skipped entirely — neither spawned nor simulated', () => {
	const sys = new ParticleSystem();
	const cam = { x: 0, y: 0, w: 80, h: 24 };
	stepParticles(
		sys,
		[bloodAt(500, 500)],
		16,
		floorTerrain(),
		seededRng(1),
		cam,
	);
	expect(sys.activeCount).toBe(0);
});

test('an on-camera Effect still spawns when a camera is supplied', () => {
	const sys = new ParticleSystem();
	const cam = { x: 0, y: 0, w: 80, h: 24 };
	stepParticles(sys, [bloodAt(10, 10)], 16, floorTerrain(), seededRng(1), cam);
	expect(sys.activeCount).toBeGreaterThan(0);
});

test('the burst size tracks the Effect intensity', () => {
	const big = new ParticleSystem();
	const small = new ParticleSystem();
	stepParticles(big, [bloodAt(5, 5, 24)], 16, floorTerrain(), seededRng(1));
	stepParticles(small, [bloodAt(5, 5, 2)], 16, floorTerrain(), seededRng(1));
	expect(big.activeCount).toBeGreaterThan(small.activeCount);
});
