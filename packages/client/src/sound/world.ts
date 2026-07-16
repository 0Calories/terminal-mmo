import type { VisualEffect, VisualEffectKind } from '../render/present';
import type { SoundKind } from './registry';

export const EFFECT_SOUND_MAP: Record<VisualEffectKind, SoundKind> = {
	blood: 'hit',
	gore: 'death',
	impact: 'hit',
};

export const AUDIBLE_RADIUS = 60;

export interface SpatialCue {
	pan: number;
	volume: number;
}

export interface SoundCue extends SpatialCue {
	kind: SoundKind;
}

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

export function effectSoundCues(
	effects: readonly VisualEffect[],
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
