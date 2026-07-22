import { burstCount, type EffectDef } from '../profile';

export const gore: EffectDef = {
	profile: {
		gravity: 50,
		restitution: 0.3,
		collide: true,
		restMs: 3000,
		fadeMs: 900,
		maxLifeMs: 7000,
		launchSpeed: 18,
		launchSpread: 12,
		glyphs: {
			airborne: ['▆', '▅', '▄', '▓', '▃'],
			rest: ['▅', '▄', '▓', '▃'],
		},
		colors: [
			{ t: 0, r: 200, g: 30, b: 30 },
			{ t: 0.5, r: 120, g: 18, b: 18 },
			{ t: 1, r: 70, g: 10, b: 10 },
		],
	},
	count: (intensity) => burstCount(intensity, 0.5),
};
