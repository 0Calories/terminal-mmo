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
	// A short noise burst — the percussive "thwack" of a landed hit. Noise gives
	// the impact texture a tone can't; kept brief so rapid swings don't smear.
	hit: {
		wave: 'noise',
		freq: 0,
		durationMs: 70,
		releaseMs: 50,
		volume: 0.22,
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
