import type { Terrain, Tint } from '@mmo/core/entities';
import { isSolid, isWall, sweepPoint } from '@mmo/core/physics';
import type { ColorStop, Profile, Speck } from './profile';

export const POOL_SIZE = 2000;

const FACE_EPS = 1e-3;

const UNSPAWNED: Profile = {
	gravity: 0,
	restitution: 0,
	collide: false,
	restMs: 0,
	fadeMs: 1,
	maxLifeMs: 1,
	launchSpeed: 0,
	launchSpread: 0,
	primitive: 'pixel',
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
			p.active = false;
			return;
		} else {
			let x = nx;
			let y = ny;
			let hit = sweepPoint(t, p.x, p.y, nx, ny);
			if (hit && hit.axis === 'x') {
				x = nx > p.x ? hit.x - FACE_EPS : hit.x;
				p.vx = 0;
				hit = sweepPoint(t, x, p.y, x, ny);
			}
			if (hit && hit.axis === 'y') {
				if (ny > p.y) {
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
					y = hit.y;
					p.vy = 0;
				}
			}
			p.x = x;
			p.y = y;
		}
	} else if (p.stage === 'rest') {
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
	const glyphs = p.profile.glyphs;
	if (!glyphs) return ' ';
	const set = p.stage === 'airborne' ? glyphs.airborne : glyphs.rest;
	return set[Math.min(set.length - 1, Math.floor(p.seed * set.length))];
}
