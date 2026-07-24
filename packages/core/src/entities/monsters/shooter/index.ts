import { ARCHETYPES } from '../../archetypes';
import type { Brain } from '../../brain';
import { skeletonBrain, walkEngine } from '../shared';
import { fireEngine } from './fire';

export { type FireMemory, type FireShape, fireEngine } from './fire';

const stats = ARCHETYPES.shooter.ranged;

export const shooterBrain: Brain = skeletonBrain({
	vision: stats.aggro,
	movement: walkEngine({ deadzone: 0 }),
	combat: fireEngine({ keepDist: stats.keepDist }),
});
