// The generic speck simulator: a fixed pool advanced per render frame, with
// terrain collision resolved through core physics' shared `sweepPoint`
// (ADR 0013 amendment) — the engine owns no collision code of its own, so
// specks, projectiles, and entities cannot disagree about what solid means.
// One-way rule carried by the sweep: descending specks land on platform tops,
// ascending specks pass through; only walls block sideways.
//
// Module-internal — the barrel exports only the ParticleEngine named-effect
// surface; tests may reach in here for invariant assertions.

import type { Terrain, Tint } from '@mmo/core/entities';
import { isSolid, isWall, sweepPoint } from '@mmo/core/physics';
import type { ColorStop, Profile, Speck } from './profile';

export const POOL_SIZE = 2000;

// Clipped travel stops a hair inside the empty cell rather than exactly on the
// boundary, so `floor` (the sim cell, the draw cell, the next sweep's column)
// never lands in the solid the speck just hit.
const FACE_EPS = 1e-3;

// Inert pool filler; every field is overwritten by the first spawn into the slot.
const UNSPAWNED: Profile = {
	gravity: 0,
	restitution: 0,
	collide: false,
	restMs: 0,
	fadeMs: 1,
	maxLifeMs: 1,
	launchSpeed: 0,
	launchSpread: 0,
	glyphs: { airborne: [' '], rest: [' '] },
	colors: [{ t: 0, r: 0, g: 0, b: 0 }],
};

export class Pool {
	readonly specks: Speck[];
	private bornCounter = 0;

	constructor(size = POOL_SIZE) {
		this.specks = new Array(size);
		for (let i = 0; i < size; i++)
			this.specks[i] = {
				active: false,
				profile: UNSPAWNED,
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
		for (const p of this.specks) if (p.active) n++;
		return n;
	}

	clear(): void {
		for (const p of this.specks) p.active = false;
	}

	// A free slot if any, else evict-oldest.
	claim(): Speck {
		let slot: Speck | null = null;
		let oldest: Speck = this.specks[0];
		for (const p of this.specks) {
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
}

export function spawnSpeck(
	pool: Pool,
	profile: Profile,
	x: number,
	y: number,
	dir: -1 | 0 | 1,
	rng: () => number,
	tint?: Tint,
): void {
	const p = pool.claim();
	const spread = (rng() - 0.5) * 2;
	const speed = profile.launchSpeed + rng() * profile.launchSpread;
	let angle: number;
	if (dir === 0) angle = rng() * Math.PI * 2;
	else {
		const base = dir === 1 ? -Math.PI / 4 : (-Math.PI * 3) / 4;
		angle = base + spread * (Math.PI / 4);
	}
	p.active = true;
	p.profile = profile;
	p.x = x;
	p.y = y;
	p.vx = Math.cos(angle) * speed;
	p.vy = Math.sin(angle) * speed;
	p.stage = 'airborne';
	p.bounced = false;
	p.ageMs = 0;
	p.stageMs = 0;
	p.seed = rng();
	p.tint = tint;
}

export function advanceSpecks(
	pool: Pool,
	dtMs: number,
	terrain: Terrain,
): void {
	const dt = dtMs / 1000;
	for (const p of pool.specks) {
		if (!p.active) continue;
		advance(p, dt, dtMs, terrain);
	}
}

function advance(p: Speck, dt: number, dtMs: number, t: Terrain): void {
	const prof = p.profile;
	p.ageMs += dtMs;

	if (p.stage === 'airborne') {
		p.vy += prof.gravity * dt;
		const nx = p.x + p.vx * dt;
		const ny = p.y + p.vy * dt;
		if (!prof.collide) {
			p.x = nx;
			p.y = ny;
		} else if (isWall(t, Math.floor(p.x), Math.floor(p.y))) {
			// A colliding speck whose own cell is solid dies instead of resting
			// (the lintel bug's backstop: nothing may ever settle inside terrain).
			// Wall-solid only: a speck rising through a one-way platform's cell
			// is mid-pass, not embedded.
			p.active = false;
			return;
		} else {
			let x = nx;
			let y = ny;
			let hit = sweepPoint(t, p.x, p.y, nx, ny);
			if (hit && hit.axis === 'x') {
				// Wall face: stop dead in the near empty column and let the
				// vertical remainder of the travel resolve on its own.
				x = nx > p.x ? hit.x - FACE_EPS : hit.x;
				p.vx = 0;
				hit = sweepPoint(t, x, p.y, x, ny);
			}
			if (hit && hit.axis === 'y') {
				if (ny > p.y) {
					// Landed on a top face: bounce once, rest the second time.
					y = hit.y - FACE_EPS;
					if (!p.bounced) {
						p.vy = -Math.abs(p.vy) * prof.restitution;
						p.vx *= prof.restitution;
						p.bounced = true;
					} else {
						p.vx = 0;
						p.vy = 0;
						p.stage = 'rest';
						p.stageMs = 0;
					}
				} else {
					// Rising into an underside: clip there and let gravity reclaim
					// it — the old engine never swept upward, which is how specks
					// embedded inside thick solids.
					y = hit.y;
					p.vy = 0;
				}
			}
			p.x = x;
			p.y = y;
		}
	} else if (p.stage === 'rest') {
		// Terrain can change under a rested speck (#373): a rest embedded in a
		// wall dies like an airborne speck would, and one whose support vanished
		// is reclaimed by gravity (bounced stays set, so it re-rests on landing).
		const col = Math.floor(p.x);
		const row = Math.floor(p.y);
		if (isWall(t, col, row)) {
			p.active = false;
			return;
		}
		if (!isSolid(t, col, row + 1)) {
			p.stage = 'airborne';
			p.stageMs = 0;
		} else {
			p.stageMs += dtMs;
			if (p.stageMs >= prof.restMs) {
				p.stage = 'fade';
				p.stageMs = 0;
			}
		}
	} else {
		p.stageMs += dtMs;
		if (p.stageMs >= prof.fadeMs) p.active = false;
	}

	if (p.ageMs >= prof.maxLifeMs) p.active = false;
}

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

function tintStops(tint: Tint): ColorStop[] {
	const dim = (v: number) => Math.round(v * 0.4);
	return [
		{ t: 0, r: tint.r, g: tint.g, b: tint.b },
		{ t: 1, r: dim(tint.r), g: dim(tint.g), b: dim(tint.b) },
	];
}

function fadeRamp(elapsedMs: number, fadeMs: number): number {
	return Math.round(255 * Math.max(0, Math.min(1, 1 - elapsedMs / fadeMs)));
}

export function speckColor(p: Speck): Rgba {
	const stops = p.tint ? tintStops(p.tint) : p.profile.colors;
	const t = Math.max(0, Math.min(1, p.ageMs / p.profile.maxLifeMs));
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
	// Colliding specks fade off the rest→fade stage; non-colliding sparks never rest, so fade off age instead.
	const a = p.profile.collide
		? p.stage === 'fade'
			? fadeRamp(p.stageMs, p.profile.fadeMs)
			: 255
		: fadeRamp(
				p.ageMs - (p.profile.maxLifeMs - p.profile.fadeMs),
				p.profile.fadeMs,
			);
	return { r: lerp(lo.r, hi.r), g: lerp(lo.g, hi.g), b: lerp(lo.b, hi.b), a };
}

export function speckGlyph(p: Speck): string {
	const set =
		p.stage === 'airborne' ? p.profile.glyphs.airborne : p.profile.glyphs.rest;
	return set[Math.min(set.length - 1, Math.floor(p.seed * set.length))];
}

/**
 * The world cell a speck paints. Colliding specks draw floor-aligned — the
 * cell the sim says they are in, which collision guarantees is never solid —
 * where the old round() column painted wall-adjacent specks into the wall
 * tile. A settled speck biases one row down into the visible `▄` surface cell
 * so blood sits flush on the ground line (#264). Non-colliding sparks keep
 * the nearest-cell projection; they never interact with terrain.
 */
export function speckDrawCell(
	p: Speck,
	terrain: Terrain,
): { col: number; row: number } {
	if (!p.profile.collide) return { col: Math.round(p.x), row: Math.round(p.y) };
	const col = Math.floor(p.x);
	let row = Math.floor(p.y);
	if (
		p.stage !== 'airborne' &&
		!isSolid(terrain, col, row) &&
		isSolid(terrain, col, row + 1)
	)
		row += 1;
	return { col, row };
}
