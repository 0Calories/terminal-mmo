// The world-sound feed (ADR 0014): turns a tick's authoritative combat Effects
// into spatialized SoundEffect cues. Pure and headlessly testable — the kind→sound
// mapping, death-wins suppression, and pan/distance math all live here; the
// SoundSystem just plays the cues this returns. Mirrors how `SPAWN_MAP` turns the
// same Effects into particles (the audible twin of the visible burst), reusing the
// authoritative `blood`/`gore` Effects already on the snapshot so the world feed
// needs no new wire field, and another Avatar's combat is audible for free.

import type { Effect, EffectKind } from '@mmo/shared';
import type { SoundKind } from './registry';

// Effect kind → the SoundEffect it voices. `blood` (every landed/taken hit) → hit;
// `gore` (the radial dir:0 death burst, Monster or Avatar) → death. The split is
// driven by the explicit death-marker kind, never an intensity threshold on blood,
// so audio stays decoupled from combat's damage scale. Death is the kill's voice:
// a lethal blow emits both a directional `blood` and a coincident radial `gore`, and
// `effectSoundCues` silences that blood so a kill plays death, not hit+death.
export const EFFECT_SOUND_MAP: Record<EffectKind, SoundKind> = {
	blood: 'hit',
	gore: 'death',
	// A Poise-break (ADR 0017) reuses the meaty `hit` voice — the heavier hitstop +
	// camera-kick carry the "this one landed harder" weight; a dedicated break sound
	// is deferred with the rest of the combat-audio pass.
	impact: 'hit',
	// A Parry clash (ADR 0017 §5) voices the bright `ui` blip — a metallic ting that
	// reads distinctly from the meaty `hit`, so a deflection sounds like a deflection. A
	// dedicated clash synth is deferred with the rest of the combat-audio pass.
	parry: 'ui',
	// A Launch (ADR 0017 §6) reuses the meaty `hit` voice — the launch camera-kick +
	// the rising particle column carry the "this opened a juggle" weight; a dedicated
	// launch whoosh is deferred with the rest of the combat-audio pass.
	launch: 'hit',
};

// Hard cutoff radius (world cells, horizontal): an Effect farther than this from
// the camera centre is inaudible and skipped entirely — the audio analogue of
// "off-camera Effects skipped" for particles, and a free auto-mix that fades a busy
// Zone down to the action near the Player.
export const AUDIBLE_RADIUS = 60;

export interface SpatialCue {
	pan: number; // -1 (hard left) .. 1 (hard right)
	volume: number; // 0 .. 1, distance-attenuated
}

export interface SoundCue extends SpatialCue {
	kind: SoundKind;
}

// Spatialize a world x against the camera centre: `pan` by horizontal offset
// (saturating at the screen edge so anything off-screen is hard-panned, not beyond
// ±1), `volume` by linear distance falloff to zero at the cutoff. Vertical position
// is IGNORED — a sound above or below reads the same as one level with you. Returns
// null past the cutoff radius (the caller skips it entirely).
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

// Turn one tick's combat Effects into the spatialized cues to play. Death wins:
// each `gore` emits a death cue and suppresses any `blood` at the same site — the
// lethal blow's directional blood and the death's radial gore share the dying
// entity's exact centre in the same tick, so an exact (x,y) key match is reliable.
// Out-of-range Effects are dropped; vertical position never affects pan/volume.
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
