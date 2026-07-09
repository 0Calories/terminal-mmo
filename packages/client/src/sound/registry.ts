import type { SynthSpec } from './synth';

export type SoundKind = 'jump' | 'land' | 'hit' | 'death' | 'level-up' | 'ui';

export type Bus = 'combat' | 'movement' | 'ui' | 'ambient';

export const BUSES: readonly Bus[] = ['combat', 'movement', 'ui', 'ambient'];

export const BUS_BY_KIND: Record<SoundKind, Bus> = {
	jump: 'movement',
	land: 'movement',
	hit: 'combat',
	death: 'combat',
	'level-up': 'ui',
	ui: 'ui',
};

export const SOUND_SPECS: Record<SoundKind, SynthSpec> = {
	jump: {
		wave: 'square',
		freq: 320,
		freqEnd: 660,
		durationMs: 120,
		releaseMs: 60,
		volume: 0.18,
	},
	hit: {
		wave: 'sine',
		freq: 150,
		freqEnd: 55,
		durationMs: 90,
		releaseMs: 70,
		volume: 0.45,
	},
	death: {
		wave: 'triangle',
		freq: 440,
		freqEnd: 110,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.3,
	},
	land: {
		wave: 'triangle',
		freq: 300,
		freqEnd: 140,
		durationMs: 90,
		releaseMs: 50,
		volume: 0.16,
	},
	'level-up': {
		wave: 'square',
		freq: 523,
		freqEnd: 1047,
		durationMs: 260,
		releaseMs: 120,
		volume: 0.16,
	},
	ui: {
		wave: 'sine',
		freq: 880,
		durationMs: 45,
		releaseMs: 30,
		volume: 0.18,
	},
};
