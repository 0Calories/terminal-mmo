// The `kind → source` sound registry (ADR 0014). Each entry's source is
// currently a synth spec (the MVP), but the map is deliberately source-agnostic:
// a future entry could be a `file:` path loaded via `Audio.loadSoundFile(path)`
// with no change to any caller — exactly as ParticleType decouples a look from
// the simulator that draws it. New sounds are new data here, not new code.

import type { SynthSpec } from './synth';

// Every sound the client can play, by stable identifier. This is the complete MVP
// catalog (ADR 0014): the locomotion blips (`jump`/`land`), the spatialized world
// combat feed (`hit`/`death`), and the interface voices (`level-up` flourish and
// the menu `ui` blip). `level-up` is hyphenated so it stays a single stable key.
export type SoundKind = 'jump' | 'land' | 'hit' | 'death' | 'level-up' | 'ui';

// The mixing buses (ADR 0014): named voice groups, each with independent volume
// under a master volume. `ambient` is declared but unused — reserved so the group
// structure doesn't churn when ambient/music arrives. Order is stable for the
// options modal (#150) to list.
export type Bus = 'combat' | 'movement' | 'ui' | 'ambient';

export const BUSES: readonly Bus[] = ['combat', 'movement', 'ui', 'ambient'];

// Each voice's bus. The categorisation is data, not code: a new sound picks its
// bus here and is mixed/muted with its peers for free. The combat world feed
// (`hit`/`death`) groups under `combat`; the locomotion blips (`jump`/`land`) are
// `movement`; the interface voices (`level-up` flourish, menu `ui` blip) are `ui`.
export const BUS_BY_KIND: Record<SoundKind, Bus> = {
	jump: 'movement',
	land: 'movement',
	hit: 'combat',
	death: 'combat',
	'level-up': 'ui',
	ui: 'ui',
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
	// The mirror of `jump`: a short, soft triangle "tup" sweeping *down* (the
	// inverse of jump's rising boop) so take-off and touchdown read as a matched
	// pair. Triangle (softer than jump's square) and a quick release keep it an
	// unobtrusive footfall, not a thud — it fires on every landing.
	land: {
		wave: 'triangle',
		freq: 300,
		freqEnd: 140,
		durationMs: 90,
		releaseMs: 50,
		volume: 0.16,
	},
	// The level-up flourish: a bright square sweep climbing roughly an octave
	// (~520→1050 Hz) over a longer window, so it rings out as a celebratory rise
	// distinct from the terse gameplay blips. (The synth renders a single swept
	// tone, not a true multi-note arpeggio — a discrete arpeggio would need a
	// multi-segment synth; the upward sweep is the MVP stand-in.)
	'level-up': {
		wave: 'square',
		freq: 523,
		freqEnd: 1047,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.16,
	},
	// The menu blip: a tiny, high, steady sine tick for navigate/confirm. Very
	// short and low-volume so rapid scrolling stays a soft click, never a drone.
	ui: {
		wave: 'sine',
		freq: 880,
		durationMs: 45,
		releaseMs: 30,
		volume: 0.18,
	},
};
