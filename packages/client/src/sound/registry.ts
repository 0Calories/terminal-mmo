// The `kind → source` sound registry (ADR 0014). Each entry's source is
// currently a synth spec (the MVP), but the map is deliberately source-agnostic:
// a future entry could be a `file:` path loaded via `Audio.loadSoundFile(path)`
// with no change to any caller — exactly as ParticleType decouples a look from
// the simulator that draws it. New sounds are new data here, not new code.

import type { SynthSpec } from './synth';

// Every sound the client can play, by stable identifier. The catalog grows as
// the SFX epic lands (land, level-up, UI blip still to come); this slice adds the
// world-combat voices `hit` and `death` alongside the tracer's `jump`.
export type SoundKind = 'jump' | 'hit' | 'death';

// The mixing buses (ADR 0014): named voice groups, each with independent volume
// under a master volume. `ambient` is declared but unused — reserved so the group
// structure doesn't churn when ambient/music arrives. Order is stable for the
// options modal (#150) to list.
export type Bus = 'combat' | 'movement' | 'ui' | 'ambient';

export const BUSES: readonly Bus[] = ['combat', 'movement', 'ui', 'ambient'];

// Each voice's bus. The categorisation is data, not code: a new sound picks its
// bus here and is mixed/muted with its peers for free. The combat world feed
// (`hit`/`death`) groups under `combat`; the jump blip is locomotion, so
// `movement`.
export const BUS_BY_KIND: Record<SoundKind, Bus> = {
	jump: 'movement',
	hit: 'combat',
	death: 'combat',
};

export const SOUND_SPECS: Record<SoundKind, SynthSpec> = {
	// A short rising square-wave "boop" — the chiptune-native voice of a jump.
	// A square wave reads far louder than its peak amplitude suggests (full-energy
	// waveform, rich harmonics), so the amplitude is kept low to stay unobtrusive.
	jump: {
		wave: 'square',
		freq: 320,
		freqEnd: 660,
		durationMs: 120,
		releaseMs: 60,
		volume: 0.18,
	},
	// A low, body-heavy "thump" for a landed hit: a sine (the least harsh wave)
	// dropping fast from ~150Hz to ~55Hz, so it reads as a deep meaty impact rather
	// than a sharp grating crack. Brief, with a quick release, so rapid swings stay
	// punchy and don't smear. Sine reads quieter than noise, so the amplitude runs
	// higher to land with weight.
	hit: {
		wave: 'sine',
		freq: 150,
		freqEnd: 55,
		durationMs: 90,
		releaseMs: 70,
		volume: 0.45,
	},
	// A lower, falling triangle tone — the kill's voice. Longer and descending so
	// it reads as a defeat distinct from the dry chip of a hit; triangle is softer
	// than square so a busy Zone's deaths don't blare.
	death: {
		wave: 'triangle',
		freq: 440,
		freqEnd: 110,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.3,
	},
};
