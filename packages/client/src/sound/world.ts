// The world-sound feed (ADR 0014): turns a tick's combat Effects into spatialized cues.
// Reuses the `blood`/`gore` Effects already on the snapshot (the audible twin of the
// visible burst), so it needs no new wire field and another Avatar's combat is audible free.

import type { Effect, EffectKind } from '@mmo/shared';
import type { SoundKind } from './registry';

// Effect kind → the SoundEffect it voices. The split is the explicit `gore` marker, not
// an intensity threshold, so audio stays decoupled from the damage scale. A lethal blow
// emits both `blood` and `gore`; `effectSoundCues` silences the blood so a kill plays death.
export const EFFECT_SOUND_MAP: Record<EffectKind, SoundKind> = {
	blood: 'hit',
	gore: 'death',
	// A break or swat reuses the `hit` voice — hitstop + camera-kick carry the extra weight;
	// a dedicated break sound is deferred (ADR 0017).
	impact: 'hit',
};

// Hard cutoff radius (world cells, horizontal): an Effect farther than this from the
// camera centre is skipped — a free auto-mix that fades a busy Zone to the nearby action.
export const AUDIBLE_RADIUS = 60;

export interface SpatialCue {
	pan: number; // -1 (hard left) .. 1 (hard right)
	volume: number; // 0 .. 1, distance-attenuated
}

export interface SoundCue extends SpatialCue {
	kind: SoundKind;
}

// Spatialize a world x against the camera centre: `pan` saturates at the screen edge,
// `volume` falls off linearly to zero at the cutoff. Vertical position is IGNORED.
// Returns null past the cutoff radius (the caller skips it).
export function spatialize(
	x: number,
	centerX: number,
	halfWidth: number,
	radius = AUDIBLE_RADIUS,
): SpatialCue | null {
	const dx = x - centerX;
	const dist = Math.abs(dx);
	if (dist > radius) return null;
	const pan = halfWidth > 0 ? Math.max(-1, Math.min(1, dx / halfWidth)) : 0;
	const volume = 1 - dist / radius;
	return { pan, volume };
}

// Turn a tick's combat Effects into cues. Death wins: each `gore` suppresses any `blood`
// at the same site — both share the dying entity's exact centre that tick, so an exact
// (x,y) key match is reliable. Out-of-range Effects are dropped.
export function effectSoundCues(
	effects: readonly Effect[],
	centerX: number,
	halfWidth: number,
	radius = AUDIBLE_RADIUS,
): SoundCue[] {
	const deathSites = new Set<string>();
	for (const fx of effects)
		if (fx.kind === 'gore') deathSites.add(`${fx.x},${fx.y}`);

	const cues: SoundCue[] = [];
	for (const fx of effects) {
		if (fx.kind === 'blood' && deathSites.has(`${fx.x},${fx.y}`)) continue;
		const cue = spatialize(fx.x, centerX, halfWidth, radius);
		if (cue) cues.push({ kind: EFFECT_SOUND_MAP[fx.kind], ...cue });
	}
	return cues;
}
