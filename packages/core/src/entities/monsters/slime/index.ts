import { ARCHETYPES } from '../../archetypes';
import type { Brain } from '../../brain';
import { skeletonBrain } from '../shared';
import { hopEngine } from './hop';
import { pounceEngine } from './pounce';

const stats = ARCHETYPES.slime.melee;

export const slimeBrain: Brain = skeletonBrain({
	vision: stats.aggro,
	movement: hopEngine({
		// Rests are counted in Brain calls — one per fixed 16ms zone tick.
		rest: { patrol: 25, approach: 6 },
		// Traversal hops ride flattened arcs: under-jump the shared impulse and
		// make up the ground with extra horizontal speed.
		speed: 1.35,
		jump: 0.8,
	}),
	combat: pounceEngine({ range: stats.range }),
});

export {
	type HopCadence,
	type HopMemory,
	type HopShape,
	hopEngine,
} from './hop';
export { type PounceShape, pounceEngine } from './pounce';
