import type { VisualEffect, VisualEffectKind } from '../render/present';
import type { SoundKind } from './registry';

export const EFFECT_SOUND_MAP: Record<VisualEffectKind, SoundKind> = {
	blood: 'hit',
	gore: 'death',
	impact: 'hit',
};

export const AUDIBLE_RADIUS = 100;

export interface SpatialCue {
	pan: number;
	volume: number;
}

export interface SoundCue extends SpatialCue {
	kind: SoundKind;
}

export function spatialize(
	x: number,
	listenerX: number,
	radius = AUDIBLE_RADIUS,
): SpatialCue | null {
	const dx = x - listenerX;
	const dist = Math.abs(dx);
	if (dist > radius) return null;
	const pan = Math.max(-1, Math.min(1, dx / radius));
	const volume = 1 - dist / radius;
	return { pan, volume };
}

export function effectSoundCues(
	effects: readonly VisualEffect[],
	listenerX: number,
	radius = AUDIBLE_RADIUS,
): SoundCue[] {
	const deathSites = new Set<string>();
	for (const fx of effects)
		if (fx.kind === 'gore') deathSites.add(`${fx.x},${fx.y}`);

	const cues: SoundCue[] = [];
	for (const fx of effects) {
		if (fx.kind === 'blood' && deathSites.has(`${fx.x},${fx.y}`)) continue;
		const cue = spatialize(fx.x, listenerX, radius);
		if (cue) cues.push({ kind: EFFECT_SOUND_MAP[fx.kind], ...cue });
	}
	return cues;
}
