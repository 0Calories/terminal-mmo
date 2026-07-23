import { burstCount, type EffectDef } from '../profile';

export const impact: EffectDef = {
	profile: {
		gravity: 30,
		restitution: 0.2,
		collide: false,
		restMs: 0,
		fadeMs: 220,
		maxLifeMs: 360,
		launchSpeed: 26,
		launchSpread: 16,
		primitive: 'glyph',
		glyphs: {
			airborne: ['✦', '✧', '•', '◦', '＊'],
			rest: ['·'],
		},
		colors: [
			{ t: 0, r: 255, g: 244, b: 200 },
			{ t: 0.5, r: 255, g: 200, b: 90 },
			{ t: 1, r: 200, g: 120, b: 40 },
		],
	},
	count: (intensity) => burstCount(intensity, 0.8),
};
