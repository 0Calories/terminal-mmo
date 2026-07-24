import { defineMonster } from '../shared';
import { hopEngine } from './hop';
import { pounceEngine } from './pounce';

/** Hop and pounce were founded here: the slime hires both stock. */
export const slime = defineMonster({
	stats: {
		hp: 24,
		speed: 12,
		mass: 0.85,
		damage: 8,
		vision: 22,
		range: 12,
	},
	movement: hopEngine(),
	combat: pounceEngine(),
});

export {
	HOP_DEFAULTS,
	type HopCadence,
	type HopMemory,
	type HopShape,
	hopEngine,
} from './hop';
export { POUNCE_DEFAULTS, type PounceShape, pounceEngine } from './pounce';
