// The `kind → source` sound registry (ADR 0014). Each entry's source is
// currently a synth spec (the MVP), but the map is deliberately source-agnostic:
// a future entry could be a `file:` path loaded via `Audio.loadSoundFile(path)`
// with no change to any caller — exactly as ParticleType decouples a look from
// the simulator that draws it. New sounds are new data here, not new code.

import type { SynthSpec } from './synth';

// Every sound the client can play, by stable identifier. The catalog grows as
// the SFX epic lands (land, level-up, hit, death, UI blip); the tracer ships
// just `jump` to prove the end-to-end path.
export type SoundKind = 'jump';

export const SOUND_SPECS: Record<SoundKind, SynthSpec> = {
	// A short rising square-wave "boop" — the chiptune-native voice of a jump.
	jump: {
		wave: 'square',
		freq: 320,
		freqEnd: 660,
		durationMs: 120,
		releaseMs: 60,
		volume: 0.5,
	},
};
