import { expect, test } from 'bun:test';
import type { Effect, EffectKind, Terrain } from '@mmo/shared';
import { isSolid, parseTerrain } from '@mmo/shared';
import {
	BLOOD,
	type Particle,
	ParticleSystem,
	type ParticleType,
	particleColor,
	particleDrawRow,
	SPAWN_MAP,
	speckCount,
	stepParticles,
} from '../src/particles';

// A deterministic [0,1) RNG so spawn velocities/counts are reproducible headlessly.
function seededRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

// A small arena: open sky with a solid floor along the bottom row.
function floorTerrain(w = 40, h = 20): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++) rows.push((y === h - 1 ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}

// A floor plus a tall solid wall column, so a sideways-spraying burst would embed
// into the wall without horizontal collision.
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

test('bigger hits spawn visibly more specks, clamped to a sane range', () => {
	expect(speckCount(2)).toBeGreaterThanOrEqual(1);
	expect(speckCount(40)).toBe(24); // clamped at the cap
	expect(speckCount(0)).toBeGreaterThanOrEqual(1); // a chip hit still sprays
	expect(speckCount(20)).toBeGreaterThan(speckCount(4)); // scales with damage
	expect(speckCount(-5)).toBeGreaterThanOrEqual(1); // never negative
});

test('blood is bright red at birth, darkens with age, and fades to zero alpha', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 16, 2)], 16, terrain, seededRng(3));
	const p = sys.particles[0];
	const born = particleColor(p);
	expect(born.a).toBe(255); // fully opaque while alive
	expect(born.r).toBeGreaterThan(born.g); // red-dominant
	expect(born.r).toBeGreaterThan(born.b);

	// Drive it well into the fade stage (sampled each fade frame, so the last is
	// near the end of the fade where alpha has dropped).
	let fadeColor = born;
	for (let i = 0; i < 600 && p.active; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(99));
		if (p.stage === 'fade' && p.stageMs > 0) fadeColor = particleColor(p);
	}
	// Aged toward maroon (darker red) and starting to fade.
	expect(fadeColor.r).toBeLessThan(born.r);
	expect(fadeColor.a).toBeLessThan(255);
});

test('the Effect.kind → ParticleType map routes blood to the blood profile', () => {
	expect(SPAWN_MAP.blood).toContain(BLOOD);
});

test('the pool is capped and never overflows', () => {
	const sys = new ParticleSystem(50);
	const rng = seededRng(1);
	// Many big bursts, far more specks than the pool can hold.
	for (let i = 0; i < 100; i++)
		stepParticles(sys, [bloodAt(5, 5, 24)], 16, floorTerrain(), rng);
	expect(sys.activeCount).toBeLessThanOrEqual(50);
});

test('when the pool is full the newest burst evicts the oldest specks', () => {
	const sys = new ParticleSystem(4);
	const rng = seededRng(7);
	// Fill the pool, tagging each speck's birth order via `born`.
	stepParticles(sys, [bloodAt(5, 5, 2)], 16, floorTerrain(), rng); // ~3 specks
	stepParticles(sys, [bloodAt(5, 5, 2)], 16, floorTerrain(), rng); // fills + overflows
	const borns = sys.particles.filter((p) => p.active).map((p) => p.born);
	// The pool is full and holds the most-recently-born specks (oldest evicted).
	expect(sys.activeCount).toBe(4);
	const maxBorn = Math.max(...borns);
	// every surviving speck is among the newest `size` births
	expect(Math.min(...borns)).toBeGreaterThan(maxBorn - 4);
});

test('a speck runs the full lifecycle: airborne → bounce → rest → fade → cull, landing on terrain', () => {
	const terrain = floorTerrain();
	const sys = new ParticleSystem();
	// Emit just above the floor so every speck lands quickly.
	stepParticles(sys, [bloodAt(10, 16, 2)], 16, terrain, seededRng(3));
	const p = sys.particles[0]; // follow one speck by reference across frames
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
	expect(p.active).toBe(false); // culled at the end of the fade
	// It rests ON TOP of the platform, not sunk into it: its own cell is empty and
	// the cell directly below is solid.
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY))).toBe(false);
	expect(isSolid(terrain, Math.floor(10), Math.floor(restY) + 1)).toBe(true);
});

test('a falling speck collides with the surface and never penetrates the ground', () => {
	// A tall arena so a speck builds up enough speed (>1 cell/frame) to tunnel
	// through the floor without swept collision.
	const terrain = floorTerrain(40, 80);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 2, 24)], 16, terrain, seededRng(5));
	for (let i = 0; i < 800; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(13));
		for (const p of sys.particles) {
			if (!p.active) continue;
			const col = Math.floor(p.x);
			if (col < 0 || col >= terrain.w) continue; // off-world horizontally (camera skips these)
			// Within the world it never occupies a solid cell — it lands on the
			// platform surface, not inside or below it.
			expect(isSolid(terrain, col, Math.floor(p.y))).toBe(false);
		}
	}
});

test('specks spraying sideways into a wall never embed in the solid terrain', () => {
	const terrain = wallTerrain(40, 20, 25);
	const sys = new ParticleSystem();
	// Burst just left of the wall, biased toward it — specks fly into the wall.
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
	// Floor along the bottom row (row 19). A speck physically resting just above it
	// at y = 18.6 keeps its *physics* cell (floor 18) empty, but Math.round(18.6) =
	// 19 lands the *draw* cell in the solid floor — the one-frame tunnel #134 reports.
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
	expect(isSolid(terrain, col, Math.round(sunk.y))).toBe(true); // raw round = sunk
	const row = particleDrawRow(sunk, terrain, col, Math.round(sunk.y));
	expect(isSolid(terrain, col, row)).toBe(false); // biased up out of the floor
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
	expect(row).toBe(Math.round(airborne.y)); // unchanged, already in open air
});

test('no active in-bounds speck ever DRAWS inside a solid cell over a real burst', () => {
	// The #134 acceptance test: assert the *draw row* (not just the physics row) is
	// never solid for any active speck across a full landing/bounce sequence — and
	// prove the raw Math.round projection WOULD have sunk into terrain without the
	// clamp (so the fix is load-bearing, not vacuous).
	const terrain = floorTerrain(40, 24);
	const sys = new ParticleSystem();
	stepParticles(sys, [bloodAt(10, 18, 24)], 16, terrain, seededRng(5));
	let rawWouldSink = false;
	for (let i = 0; i < 400; i++) {
		stepParticles(sys, [], 16, terrain, seededRng(17));
		for (const p of sys.particles) {
			if (!p.active) continue;
			const col = Math.round(p.x);
			if (col < 0 || col >= terrain.w) continue; // off-world (camera skips these)
			const rawRow = Math.round(p.y);
			if (isSolid(terrain, col, rawRow)) rawWouldSink = true;
			const row = particleDrawRow(p, terrain, col, rawRow);
			expect(isSolid(terrain, col, row)).toBe(false);
		}
	}
	expect(rawWouldSink).toBe(true);
});

test('a profile with no gravity and no terrain collision never settles (profile-driven)', () => {
	const FLOATER: ParticleType = {
		...BLOOD,
		gravity: 0,
		collide: false,
		launchSpeed: 0,
		launchSpread: 0,
	};
	const map: Record<EffectKind, ParticleType[]> = { blood: [FLOATER] };
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
	// With the same simulator but a different profile, the speck stays airborne
	// (no gravity to pull it down, no terrain to land on) — behavior is data-driven.
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
