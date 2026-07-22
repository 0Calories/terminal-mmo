import type { EffectDef } from '../profile';

const SPECKS = 28;

export const levelup: EffectDef = {
	profile: {
		gravity: 22,
		restitution: 0,
		collide: false,
		restMs: 0,
		fadeMs: 500,
		maxLifeMs: 1000,
		launchSpeed: 16,
		launchSpread: 12,
		glyphs: {
			airborne: ['★', '✦', '✧', '•', '＊'],
			rest: ['·'],
		},
		colors: [
			{ t: 0, r: 255, g: 240, b: 180 },
			{ t: 0.5, r: 255, g: 205, b: 90 },
			{ t: 1, r: 220, g: 150, b: 60 },
		],
	},
	count: () => SPECKS,
};
