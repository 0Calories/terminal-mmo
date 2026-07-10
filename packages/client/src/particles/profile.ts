// Module-internal particle vocabulary. A Profile is the full physical + visual
// behavior of one speck kind; an EffectDef pairs a Profile with the effect's
// count-from-intensity curve. Neither is exported from the module barrel —
// named effects (see ./effects) are the engine's only spawn door (ADR 0013
// amendment): no caller can construct or pass a physics profile.

import type { Tint } from '@mmo/core/entities';

export type Stage = 'airborne' | 'rest' | 'fade';

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
	glyphs: { airborne: string[]; rest: string[] };
	colors: ColorStop[];
}

export interface EffectDef {
	profile: Profile;
	/** How many specks a burst of the given intensity expands into. */
	count(intensity: number): number;
}

const COUNT_BASE = 2;
const COUNT_SCALE = 0.8;
const COUNT_MAX = 24;

// The shared burst-size curve: linear in intensity, clamped to a sane range,
// then scaled per effect (gore bursts chunkier but sparser than blood).
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
