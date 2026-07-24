import { ARCHETYPES } from '../archetypes';
import type { Brain } from '../brain';
import { skeletonBrain, swingEngine, walkEngine } from './shared';

const stats = ARCHETYPES.chaser.melee;

export const chaserBrain: Brain = skeletonBrain({
	vision: stats.aggro,
	movement: walkEngine({ deadzone: stats.deadzone }),
	combat: swingEngine({ range: stats.range }),
});
