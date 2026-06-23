// The client-side particle system (ADR 0013): a generic, data-driven simulator
// that realizes authoritative combat Effects into clouds of gravity-driven
// pixel Particles. The shared layer owns *what happened* (an Effect); this module
// owns *what it looks like*. Every Particle's motion and look come from its
// declarative ParticleType profile, so a new effect is a new data entry — never
// new simulator code. The simulator is a pure function over
// (particles, effects, dt, terrain, rng) and is unit-tested headlessly for its
// invariants (pool cap + evict-oldest, lifecycle transitions, off-camera skip,
// profile-driven behavior), never exact pixels.

import {
	type Effect,
	type EffectKind,
	isSolid,
	type Terrain,
} from '@mmo/shared';

// A Particle's life runs airborne → (one bounce) → rest → fade → cull. `bounced`
// records the single permitted bounce so the second ground contact settles.
export type Stage = 'airborne' | 'rest' | 'fade';

// One point on a colour-over-life curve, keyed by life fraction (0 = born,
// 1 = fully aged). The simulator interpolates between adjacent stops.
export interface ColorStop {
	t: number;
	r: number;
	g: number;
	b: number;
}

// The declarative profile that fully defines a Particle's look and lifecycle.
// One generic simulator reads this — no kind-specific branching — so adding a
// `dust`/`sparkle`/`spark` look is a new ParticleType, not new code.
export interface ParticleType {
	gravity: number; // cells/s^2 pulling the speck down
	restitution: number; // velocity retained across the one bounce (0..1)
	collide: boolean; // whether the speck lands on solid terrain
	restMs: number; // how long a settled speck rests before fading
	fadeMs: number; // fade-out duration after rest
	maxLifeMs: number; // hard lifetime cap (safety net)
	launchSpeed: number; // base outward speed at spawn (cells/s)
	launchSpread: number; // random ± added to speed and angle
	glyphs: { airborne: string[]; rest: string[] }; // per-stage glyph sets
	colors: ColorStop[]; // colour-over-life curve, bright → dark
	z: number; // render layer hint
}

// One pooled speck. Mutated in place (no per-frame allocation); `active` gates
// it, `born` orders evict-oldest, `seed` indexes glyphs deterministically.
export interface Particle {
	active: boolean;
	type: ParticleType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	stage: Stage;
	bounced: boolean;
	ageMs: number; // total time alive, for evict-oldest + maxLife cull
	stageMs: number; // time spent in the current stage
	born: number; // spawn order (monotonic); smallest = oldest
	seed: number; // [0,1) chosen at spawn, picks a glyph
}

// The `blood` profile (the MVP look): bright red erupting outward, falling under
// gravity, one small bounce, resting ~2.5s on the ground, then fading ~0.75s.
export const BLOOD: ParticleType = {
	gravity: 60,
	restitution: 0.4,
	collide: true,
	restMs: 2500,
	fadeMs: 750,
	maxLifeMs: 6000,
	launchSpeed: 14,
	launchSpread: 10,
	// Block "pixels" matching the game's pixel-art sprites (not ASCII punctuation):
	// airborne specks are sub-cell quadrant droplets; settled specks use
	// lower-anchored blocks so the pool reads as resting on the floor.
	glyphs: {
		airborne: ['▖', '▗', '▘', '▝'],
		rest: ['▄', '▃', '▖', '▗'],
	},
	colors: [
		{ t: 0, r: 220, g: 40, b: 40 }, // bright arterial red
		{ t: 0.5, r: 150, g: 25, b: 25 },
		{ t: 1, r: 90, g: 15, b: 15 }, // settled maroon
	],
	z: 0,
};

// The client-side map from a semantic game event to the look(s) it spawns. 1:1
// today; the indirection lets a future event fan out into several ParticleTypes
// (e.g. death → blood + gib) with no wire change.
export const SPAWN_MAP: Record<EffectKind, ParticleType[]> = {
	blood: [BLOOD],
};

// Fixed, preallocated pool — newest action always renders (evict-oldest), and the
// per-frame cost is bounded regardless of combat volume.
export const POOL_SIZE = 2000;

// Per-Effect speck count: a small base plus a damage-scaled term, clamped so a
// chip hit still sprays something and a huge hit never floods the pool.
const COUNT_BASE = 2;
const COUNT_SCALE = 0.8;
const COUNT_MAX = 24;

export function speckCount(intensity: number): number {
	const n = Math.round(COUNT_BASE + Math.max(0, intensity) * COUNT_SCALE);
	return Math.max(1, Math.min(COUNT_MAX, n));
}

// The on-screen region; an Effect outside it (plus a margin) is skipped entirely.
export interface Camera {
	x: number;
	y: number;
	w: number;
	h: number;
}

const OFF_CAMERA_MARGIN = 4;

function onCamera(cam: Camera, x: number, y: number): boolean {
	return (
		x >= cam.x - OFF_CAMERA_MARGIN &&
		x <= cam.x + cam.w + OFF_CAMERA_MARGIN &&
		y >= cam.y - OFF_CAMERA_MARGIN &&
		y <= cam.y + cam.h + OFF_CAMERA_MARGIN
	);
}

// A speck's current colour (rgb) and opacity (a, 0..255), derived purely from its
// profile + age so the renderer stays a thin blitter. Colour darkens along the
// profile's colour-over-life curve; alpha holds full until the fade stage, then
// ramps to zero — so overlapping specks read denser and spent blood dissolves.
export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export function particleColor(p: Particle): Rgba {
	const stops = p.type.colors;
	const t = Math.max(0, Math.min(1, p.ageMs / p.type.maxLifeMs));
	let lo = stops[0];
	let hi = stops[stops.length - 1];
	for (let i = 0; i < stops.length - 1; i++) {
		if (t >= stops[i].t && t <= stops[i + 1].t) {
			lo = stops[i];
			hi = stops[i + 1];
			break;
		}
	}
	const span = hi.t - lo.t || 1;
	const f = Math.max(0, Math.min(1, (t - lo.t) / span));
	const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
	const a =
		p.stage === 'fade'
			? Math.round(255 * Math.max(0, 1 - p.stageMs / p.type.fadeMs))
			: 255;
	return { r: lerp(lo.r, hi.r), g: lerp(lo.g, hi.g), b: lerp(lo.b, hi.b), a };
}

// The glyph for a speck this frame: an airborne speck reads as a flying mote, a
// settled one as a small splat, picked from the profile's per-stage glyph set by
// the speck's stable seed.
export function particleGlyph(p: Particle): string {
	const set =
		p.stage === 'airborne' ? p.type.glyphs.airborne : p.type.glyphs.rest;
	return set[Math.min(set.length - 1, Math.floor(p.seed * set.length))];
}

// A fixed pool of Particles plus its spawn cursor. The simulator mutates the
// particles in place; nothing here allocates per frame after construction.
export class ParticleSystem {
	readonly particles: Particle[];
	private bornCounter = 0;

	constructor(size = POOL_SIZE) {
		this.particles = new Array(size);
		for (let i = 0; i < size; i++)
			this.particles[i] = {
				active: false,
				type: BLOOD,
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
			};
	}

	get activeCount(): number {
		let n = 0;
		for (const p of this.particles) if (p.active) n++;
		return n;
	}

	// Claim a slot for a new speck: an inactive one if any, else evict the oldest
	// (smallest `born`) so the most recent action is never visually dropped.
	private claim(): Particle {
		let slot: Particle | null = null;
		let oldest: Particle = this.particles[0];
		for (const p of this.particles) {
			if (!p.active) {
				slot = p;
				break;
			}
			if (p.born < oldest.born) oldest = p;
		}
		const p = slot ?? oldest;
		p.born = this.bornCounter++;
		return p;
	}

	spawn(
		type: ParticleType,
		x: number,
		y: number,
		dir: -1 | 0 | 1,
		rng: () => number,
	): void {
		const p = this.claim();
		// dir 0 = radial (full circle); ±1 = a cone biased that way and upward.
		const spread = (rng() - 0.5) * 2; // [-1,1)
		const speed = type.launchSpeed + rng() * type.launchSpread;
		let angle: number;
		if (dir === 0) angle = rng() * Math.PI * 2;
		else {
			// centre on up-and-out (−45°-ish toward `dir`), widened by spread
			const base = dir === 1 ? -Math.PI / 4 : (-Math.PI * 3) / 4;
			angle = base + spread * (Math.PI / 4);
		}
		p.active = true;
		p.type = type;
		p.x = x;
		p.y = y;
		p.vx = Math.cos(angle) * speed;
		p.vy = Math.sin(angle) * speed;
		p.stage = 'airborne';
		p.bounced = false;
		p.ageMs = 0;
		p.stageMs = 0;
		p.seed = rng();
	}
}

// Advance the whole system one frame: expand fresh Effects into specks, then move
// every active speck through its lifecycle. Pure given the injected `rng`; mutates
// `sys` in place. Off-camera Effects (when `cam` is supplied) are skipped entirely
// — neither spawned nor simulated.
export function stepParticles(
	sys: ParticleSystem,
	effects: readonly Effect[],
	dtMs: number,
	terrain: Terrain,
	rng: () => number,
	cam?: Camera,
	spawnMap: Record<EffectKind, ParticleType[]> = SPAWN_MAP,
): void {
	for (const fx of effects) {
		if (cam && !onCamera(cam, fx.x, fx.y)) continue;
		const types = spawnMap[fx.kind];
		if (!types) continue;
		const count = speckCount(fx.intensity);
		for (const type of types)
			for (let i = 0; i < count; i++) sys.spawn(type, fx.x, fx.y, fx.dir, rng);
	}

	const dt = dtMs / 1000;
	for (const p of sys.particles) {
		if (!p.active) continue;
		advance(p, dt, dtMs, terrain);
	}
}

// The row of the topmost solid cell a downward-moving speck crosses between `fromY`
// and `toY` in column `col`, or -1 if it crosses none (or isn't descending). A
// swept check over every crossed cell, so a fast speck collides with the surface
// instead of tunneling through it.
function surfaceHit(
	terrain: Terrain,
	col: number,
	fromY: number,
	toY: number,
): number {
	if (toY <= fromY) return -1; // not descending (rising / horizontal)
	const start = Math.floor(fromY) + 1;
	const end = Math.floor(toY);
	for (let row = Math.max(0, start); row <= end; row++)
		if (isSolid(terrain, col, row)) return row;
	return -1;
}

// Move one active speck forward by `dt` seconds. Lifecycle:
// airborne (gravity + one bounce + land) → rest → fade → cull.
function advance(
	p: Particle,
	dt: number,
	dtMs: number,
	terrain: Terrain,
): void {
	const type = p.type;
	p.ageMs += dtMs;

	if (p.stage === 'airborne') {
		p.vy += type.gravity * dt;
		const nx = p.x + p.vx * dt;
		const ny = p.y + p.vy * dt;
		const surface = type.collide
			? surfaceHit(terrain, Math.floor(nx), p.y, ny)
			: -1;
		if (surface >= 0) {
			// Land on the surface: the empty cell directly ABOVE the topmost solid
			// row the speck crossed this frame (a swept check, so a fast speck can't
			// tunnel into or below the platform before colliding).
			p.x = nx;
			p.y = surface - 1;
			if (!p.bounced) {
				// The single permitted bounce: reflect and damp.
				p.vy = -Math.abs(p.vy) * type.restitution;
				p.vx *= type.restitution;
				p.bounced = true;
			} else {
				p.vx = 0;
				p.vy = 0;
				p.stage = 'rest';
				p.stageMs = 0;
			}
		} else {
			p.x = nx;
			p.y = ny;
		}
	} else if (p.stage === 'rest') {
		p.stageMs += dtMs;
		if (p.stageMs >= type.restMs) {
			p.stage = 'fade';
			p.stageMs = 0;
		}
	} else {
		// fade
		p.stageMs += dtMs;
		if (p.stageMs >= type.fadeMs) p.active = false;
	}

	if (p.ageMs >= type.maxLifeMs) p.active = false;
}
