// The kind → source sound registry (ADR 0014). Source-agnostic by design: an entry
// could become a `file:` path loaded via `Audio.loadSoundFile` with no caller change.

import type { SynthSpec } from './synth';

export type SoundKind = 'jump' | 'land' | 'hit' | 'death' | 'level-up' | 'ui';

// Mixing buses (ADR 0014). `ambient` is reserved (unused) so the group structure
// doesn't churn when music arrives; order is stable for the options modal to list (#150).
export type Bus = 'combat' | 'movement' | 'ui' | 'ambient';

export const BUSES: readonly Bus[] = ['combat', 'movement', 'ui', 'ambient'];

// Each voice's bus — a new sound picks its bus here and mixes with its peers for free.
export const BUS_BY_KIND: Record<SoundKind, Bus> = {
	jump: 'movement',
	land: 'movement',
	hit: 'combat',
	death: 'combat',
	'level-up': 'ui',
	ui: 'ui',
};

export const SOUND_SPECS: Record<SoundKind, SynthSpec> = {
	// Rising square-wave "boop". A square reads far louder than its peak amplitude
	// (rich harmonics), so the volume is kept low.
	jump: {
		wave: 'square',
		freq: 320,
		freqEnd: 660,
		durationMs: 120,
		releaseMs: 60,
		volume: 0.18,
	},
	// Low body-heavy "thump": a sine dropping fast so it reads as a meaty impact, not a
	// grating crack. Brief release so rapid swings don't smear; sine reads quiet, so the
	// volume runs higher.
	hit: {
		wave: 'sine',
		freq: 150,
		freqEnd: 55,
		durationMs: 90,
		releaseMs: 70,
		volume: 0.45,
	},
	// Falling triangle tone: longer and descending so a kill reads distinct from a hit;
	// triangle is soft so a busy Zone's deaths don't blare.
	death: {
		wave: 'triangle',
		freq: 440,
		freqEnd: 110,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.3,
	},
	// The mirror of `jump`: a soft triangle sweeping down so take-off and touchdown read
	// as a pair. Kept unobtrusive — it fires on every landing.
	land: {
		wave: 'triangle',
		freq: 300,
		freqEnd: 140,
		durationMs: 90,
		releaseMs: 50,
		volume: 0.16,
	},
	// Bright square sweep climbing ~an octave so it rings out as a celebratory rise. A
	// single swept tone, not a true arpeggio (that needs a multi-segment synth) — MVP.
	'level-up': {
		wave: 'square',
		freq: 523,
		freqEnd: 1047,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.16,
	},
	// Tiny high sine tick for navigate/confirm; short and quiet so rapid scrolling stays
	// a soft click, not a drone.
	ui: {
		wave: 'sine',
		freq: 880,
		durationMs: 45,
		releaseMs: 30,
		volume: 0.18,
	},
};
