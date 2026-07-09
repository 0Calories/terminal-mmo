import type { Effect, EffectKind } from '@mmo/core';
import type { ParticleSystem, ParticleType } from './particles';

/**
 * The realization adapter — the one place that knows what an Effect kind *looks
 * like*: which ParticleType profiles it bursts into, and whether it punches the
 * camera or freezes the view for a beat. A new look is a new data entry here,
 * never new code in the engine or a special case in render.
 */
export interface Realization {
	particles: ParticleType[];
	// Punch the camera along the hit direction (see camera-kick.ts).
	kick: boolean;
	// Freeze the redraw for a beat (see hitstop.ts).
	hitstop: boolean;
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

// Client-only cosmetic, off the wire and sim — spawned by intent, not by an Effect.
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

export const REALIZE: Record<EffectKind, Realization> = {
	blood: { particles: [BLOOD], kick: false, hitstop: false },
	gore: { particles: [GORE], kick: false, hitstop: false },
	impact: { particles: [IMPACT], kick: true, hitstop: true },
};

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

export function spawnEffects(
	sys: ParticleSystem,
	effects: readonly Effect[],
	rng: () => number,
	cam?: Camera,
	realize: Record<EffectKind, Realization> = REALIZE,
): void {
	for (const fx of effects) {
		if (cam && !onCamera(cam, fx.x, fx.y)) continue;
		const realization = realize[fx.kind];
		if (!realization) continue;
		const base = speckCount(fx.intensity);
		for (const type of realization.particles) {
			const count = Math.max(1, Math.round(base * type.countScale));
			for (let i = 0; i < count; i++)
				sys.spawn(type, fx.x, fx.y, fx.dir, rng, fx.tint);
		}
	}
}
