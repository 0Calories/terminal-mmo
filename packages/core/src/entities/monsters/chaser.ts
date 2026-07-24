import { DEFAULT_MASS } from '../../physics/constants';
import { defineMonster, swingEngine, walkEngine } from './shared';

/** Walk and swing were founded here: the chaser hires both stock. */
export const chaser = defineMonster({
	stats: {
		hp: 32,
		speed: 13,
		mass: DEFAULT_MASS,
		damage: 11,
		vision: 22,
		range: 4,
	},
	movement: walkEngine(),
	combat: swingEngine(),
});
