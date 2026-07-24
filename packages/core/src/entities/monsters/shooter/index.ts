import { DEFAULT_MASS } from '../../../physics/constants';
import { defineMonster, walkEngine } from '../shared';
import { fireEngine } from './fire';

/** Fire was founded here: the shooter hires it stock, and closes all the way
 *  to its destination — the comfort band already is the standoff. */
export const shooter = defineMonster({
	stats: {
		hp: 16,
		speed: 9,
		mass: DEFAULT_MASS,
		damage: 7,
		vision: 46,
		range: 20,
	},
	movement: walkEngine({ deadzone: 0 }),
	combat: fireEngine(),
});

export {
	FIRE_DEFAULTS,
	type FireMemory,
	type FireOverrides,
	type FireShape,
	fireEngine,
	PROJECTILE_DEFAULTS,
	type ProjectileShape,
} from './fire';
