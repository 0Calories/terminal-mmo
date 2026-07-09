import {
	type Effect,
	type EffectKind,
	isSolid,
	type Terrain,
	type Tint,
} from '@mmo/shared';

export type Stage = 'airborne' | 'rest' | 'fade';

export interface ColorStop {
	t: number;
	r: number;
	g: number;
	b: number;
}

export interface ParticleType {
	gravity: number;
	restitution: number;
	collide: boolean;
	restMs: number;
	fadeMs: number;
	maxLifeMs: number;
	launchSpeed: number;
	launchSpread: number;
	countScale: number;
	glyphs: { airborne: string[]; rest: string[] };
	colors: ColorStop[];
	z: number;
}

export interface Particle {
	active: boolean;
	type: ParticleType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	stage: Stage;
	bounced: boolean;
	ageMs: number;
	stageMs: number;
	born: number;
	seed: number;
	tint?: Tint;
}

export const BLOOD: ParticleType = {
	gravity: 60,
	restitution: 0.4,
	collide: true,
	restMs: 2500,
	fadeMs: 750,
	maxLifeMs: 6000,
	launchSpeed: 14,
	launchSpread: 10,
	countScale: 1,
	glyphs: {
		airborne: ['▄', '▖', '▗', '▘', '▝'],
		rest: ['▄', '▃', '▖', '▗'],
	},
	colors: [
		{ t: 0, r: 220, g: 40, b: 40 },
		{ t: 0.5, r: 150, g: 25, b: 25 },
		{ t: 1, r: 90, g: 15, b: 15 },
	],
	z: 0,
};

export const GORE: ParticleType = {
	gravity: 50,
	restitution: 0.3,
	collide: true,
	restMs: 3000,
	fadeMs: 900,
	maxLifeMs: 7000,
	launchSpeed: 18,
	launchSpread: 12,
	countScale: 0.5,
	glyphs: {
		airborne: ['▆', '▅', '▄', '▓', '▃'],
		rest: ['▅', '▄', '▓', '▃'],
	},
	colors: [
		{ t: 0, r: 200, g: 30, b: 30 },
		{ t: 0.5, r: 120, g: 18, b: 18 },
		{ t: 1, r: 70, g: 10, b: 10 },
	],
	z: 0,
};

export const IMPACT: ParticleType = {
	gravity: 30,
	restitution: 0.2,
	collide: false,
	restMs: 0,
	fadeMs: 220,
	maxLifeMs: 360,
	launchSpeed: 26,
	launchSpread: 16,
	countScale: 0.8,
	glyphs: {
		airborne: ['✦', '✧', '•', '◦', '＊'],
		rest: ['·'],
	},
	colors: [
		{ t: 0, r: 255, g: 244, b: 200 },
		{ t: 0.5, r: 255, g: 200, b: 90 },
		{ t: 1, r: 200, g: 120, b: 40 },
	],
	z: 0,
};

// Client-only cosmetic, off the wire and sim — spawned directly by the playfield.
export const LEVELUP: ParticleType = {
	gravity: 22,
	restitution: 0,
	collide: false,
	restMs: 0,
	fadeMs: 500,
	maxLifeMs: 1000,
	launchSpeed: 16,
	launchSpread: 12,
	countScale: 1,
	glyphs: {
		airborne: ['★', '✦', '✧', '•', '＊'],
		rest: ['·'],
	},
	colors: [
		{ t: 0, r: 255, g: 240, b: 180 },
		{ t: 0.5, r: 255, g: 205, b: 90 },
		{ t: 1, r: 220, g: 150, b: 60 },
	],
	z: 0,
};

export const LEVELUP_SPECKS = 28;

export const SPAWN_MAP: Record<EffectKind, ParticleType[]> = {
	blood: [BLOOD],
	gore: [GORE],
	impact: [IMPACT],
};

export const POOL_SIZE = 2000;

const COUNT_BASE = 2;
const COUNT_SCALE = 0.8;
const COUNT_MAX = 24;

export function speckCount(intensity: number): number {
	const n = Math.round(COUNT_BASE + Math.max(0, intensity) * COUNT_SCALE);
	return Math.max(1, Math.min(COUNT_MAX, n));
}

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

export function particleColor(p: Particle): Rgba {
	const stops = p.tint ? tintStops(p.tint) : p.type.colors;
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
	// Colliding specks fade off the rest→fade stage; non-colliding sparks never rest, so fade off age instead.
	const a = p.type.collide
		? p.stage === 'fade'
			? fadeRamp(p.stageMs, p.type.fadeMs)
			: 255
		: fadeRamp(p.ageMs - (p.type.maxLifeMs - p.type.fadeMs), p.type.fadeMs);
	return { r: lerp(lo.r, hi.r), g: lerp(lo.g, hi.g), b: lerp(lo.b, hi.b), a };
}

export function particleGlyph(p: Particle): string {
	const set =
		p.stage === 'airborne' ? p.type.glyphs.airborne : p.type.glyphs.rest;
	return set[Math.min(set.length - 1, Math.floor(p.seed * set.length))];
}

export function particleDrawRow(
	p: Particle,
	terrain: Terrain,
	col: number,
	row: number,
): number {
	if (!p.type.collide) return row;
	// Bias a settled speck down into the ▄ surface cell so it sits flush on the visible ground, not a half-cell above.
	if (p.stage !== 'airborne') {
		return !isSolid(terrain, col, row) && isSolid(terrain, col, row + 1)
			? row + 1
			: row;
	}
	// Bias an airborne near-surface speck up out of solid so in-flight blood is never painted inside terrain.
	let r = row;
	while (r > 0 && isSolid(terrain, col, r)) r--;
	return r;
}

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
		tint?: Tint,
	): void {
		const p = this.claim();
		const spread = (rng() - 0.5) * 2;
		const speed = type.launchSpeed + rng() * type.launchSpread;
		let angle: number;
		if (dir === 0) angle = rng() * Math.PI * 2;
		else {
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
		p.tint = tint;
	}
}

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
		const base = speckCount(fx.intensity);
		for (const type of types) {
			const count = Math.max(1, Math.round(base * type.countScale));
			for (let i = 0; i < count; i++)
				sys.spawn(type, fx.x, fx.y, fx.dir, rng, fx.tint);
		}
	}

	const dt = dtMs / 1000;
	for (const p of sys.particles) {
		if (!p.active) continue;
		advance(p, dt, dtMs, terrain);
	}
}

// Swept over every crossed cell so a fast speck can't tunnel through the surface.
function surfaceHit(
	terrain: Terrain,
	col: number,
	fromY: number,
	toY: number,
): number {
	if (toY <= fromY) return -1;
	const start = Math.floor(fromY) + 1;
	const end = Math.floor(toY);
	for (let row = Math.max(0, start); row <= end; row++)
		if (isSolid(terrain, col, row)) return row;
	return -1;
}

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
		let nx = p.x + p.vx * dt;
		const ny = p.y + p.vy * dt;
		if (
			type.collide &&
			Math.floor(nx) !== Math.floor(p.x) &&
			isSolid(terrain, Math.floor(nx), Math.floor(p.y)) &&
			!isSolid(terrain, Math.floor(p.x), Math.floor(p.y))
		) {
			nx = p.x;
			p.vx = 0;
		}
		const surface = type.collide
			? surfaceHit(terrain, Math.floor(nx), p.y, ny)
			: -1;
		if (surface >= 0) {
			p.x = nx;
			p.y = surface - 1;
			if (!p.bounced) {
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
		p.stageMs += dtMs;
		if (p.stageMs >= type.fadeMs) p.active = false;
	}

	if (p.ageMs >= type.maxLifeMs) p.active = false;
}
