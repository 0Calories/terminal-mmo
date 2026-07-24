import { ARCHETYPES } from '../../archetypes';
import type { Brain } from '../../brain';
import type { MonsterSpec } from '../shared';
import { skeletonBrain, walkEngine } from '../shared';
import { fireEngine } from './fire';

export { type FireMemory, type FireShape, fireEngine } from './fire';

const stats = ARCHETYPES.shooter.ranged;

export const shooterSpec: MonsterSpec = {
	vision: stats.aggro,
	movement: walkEngine({ deadzone: 0 }),
	combat: fireEngine({
		keepDist: stats.keepDist,
		cooldown: stats.fireCooldown,
	}),
};

export const shooterBrain: Brain = skeletonBrain(shooterSpec);
