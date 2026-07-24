import { defineMonster, swingEngine, walkEngine } from './shared';

export const brute = defineMonster({
	stats: {
		hp: 60,
		speed: 6,
		mass: 4,
		poise: 48,
		damage: 18,
		vision: 26,
		range: 5,
	},
	movement: walkEngine(),
	combat: swingEngine({ cooldown: 1.6, poiseDamage: 16 }),
});
