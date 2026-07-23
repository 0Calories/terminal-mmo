import { burstCount, type EffectDef } from '../profile';

export const blood: EffectDef = {
	profile: {
		gravity: 60,
		restitution: 0.4,
		collide: true,
		restMs: 2500,
		fadeMs: 750,
		maxLifeMs: 6000,
		launchSpeed: 14,
		launchSpread: 10,
		primitive: 'pixel',
		colors: [
			{ t: 0, r: 220, g: 40, b: 40 },
			{ t: 0.5, r: 150, g: 25, b: 25 },
			{ t: 1, r: 90, g: 15, b: 15 },
		],
	},
	count: (intensity) => burstCount(intensity, 1),
};
