import type { Tint } from '@mmo/core/entities';

export type Stage = 'airborne' | 'rest' | 'fade';

/**
 * How a profile's specks render (ADR 0038). `pixel` specks are fine sub-cell
 * colours composited translucently against the composed scene; `glyph` specks
 * stamp a character snapped to the nearest cell, deriving their backdrop from
 * the scene beneath. Every profile makes this choice explicitly.
 */
export type ParticlePrimitive = 'pixel' | 'glyph';

export interface ColorStop {
	t: number;
	r: number;
	g: number;
	b: number;
}

export interface Profile {
	gravity: number;
	restitution: number;
	collide: boolean;
	restMs: number;
	fadeMs: number;
	maxLifeMs: number;
	launchSpeed: number;
	launchSpread: number;
	primitive: ParticlePrimitive;
	/** Character set for `glyph` profiles; `pixel` profiles render no glyph. */
	glyphs?: { airborne: string[]; rest: string[] };
	colors: ColorStop[];
}

export interface EffectDef {
	profile: Profile;

	count(intensity: number): number;
}

const COUNT_BASE = 2;
const COUNT_SCALE = 0.8;
const COUNT_MAX = 24;

export function burstCount(intensity: number, scale: number): number {
	const base = Math.round(COUNT_BASE + Math.max(0, intensity) * COUNT_SCALE);
	const clamped = Math.max(1, Math.min(COUNT_MAX, base));
	return Math.max(1, Math.round(clamped * scale));
}

export interface Speck {
	active: boolean;
	profile: Profile;
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
