import { meleeKnockback } from '../../combat/combat';
import { ARCHETYPES } from '../archetypes';
import type { Brain } from '../brain';
import type { MonsterSpec } from './shared';
import { skeletonBrain, swingEngine, walkEngine } from './shared';

const stats = ARCHETYPES.chaser.melee;

export const chaserSpec: MonsterSpec = {
	vision: stats.aggro,
	movement: walkEngine({ deadzone: stats.deadzone }),
	combat: swingEngine({
		range: stats.range,
		cooldown: stats.commitCd,
		strike: {
			damage: stats.damage,
			poiseDamage: stats.poise,
			...meleeKnockback(stats),
		},
	}),
};

export const chaserBrain: Brain = skeletonBrain(chaserSpec);
