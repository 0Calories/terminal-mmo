import { meleeActive, meleeHitbox, SWING_TOTAL } from '../../../combat/combat';
import type { CombatEngine } from './skeleton';
import { toward } from './skeleton';
import type { MeleeStrikeShape } from './strike';
import { monsterStrike } from './strike';

export interface SwingShape {
	/** Distance at which the swing lands, so the distance it commits from. */
	range: number;

	/** Cooldown a commit starts. */
	cooldown: number;

	strike: MeleeStrikeShape;
}

/** Melee pattern: close on the target and commit a swing once it is in reach. */
export function swingEngine(shape: SwingShape): CombatEngine {
	return {
		fight: ({ monster, view, perception, movement, memory }) => {
			const destX = perception.targetX ?? monster.x;
			const step = movement.moveToward(monster, view, destX, memory.movement);
			const holding =
				perception.adx > shape.range || (monster.attackCdT ?? 0) > 0;
			return {
				drive: holding
					? step.drive
					: { ...step.drive, face: toward(perception.dx), commit: 'swing' },
				movement: step.memory,
			};
		},

		commit: (m) => ({
			...m,
			attackT: SWING_TOTAL,
			attackCdT: shape.cooldown,
			swingHits: [],
		}),

		project: (m) =>
			meleeActive(m.attackT)
				? { strikes: [monsterStrike(m, meleeHitbox(m), shape.strike)] }
				: {},
	};
}
