import { COMBAT } from '../../../combat/constants';
import { meleeActive, meleeHitbox, SWING_TOTAL } from '../../../combat/melee';
import type { CombatBuild } from './sheet';
import type { CombatEngine } from './skeleton';
import { toward } from './skeleton';
import type { MeleeStrikeShape } from './strike';
import { monsterStrike } from './strike';

export interface SwingShape {
	/** Cooldown a commit starts. */
	cooldown: number;

	poiseDamage: number;

	/** Scales the Strike impulse over the shared melee knockback. */
	knockback: number;
}

/** Swing's founding monster is the chaser. */
export const SWING_DEFAULTS: SwingShape = {
	cooldown: 0,
	poiseDamage: 10,
	knockback: 1,
};

/** Melee pattern: close on the target and commit a swing once it is in reach. */
export function swingEngine(overrides: Partial<SwingShape> = {}): CombatBuild {
	const shape: SwingShape = { ...SWING_DEFAULTS, ...overrides };
	return (stats): CombatEngine => {
		const strike: MeleeStrikeShape = {
			damage: stats.damage,
			poiseDamage: shape.poiseDamage,
			knockback: shape.knockback,
		};
		return {
			timings: COMBAT.swing,

			fight: ({ monster, view, perception, movement, memory }) => {
				const destX = perception.targetX ?? monster.x;
				const step = movement.moveToward(monster, view, destX, memory.movement);
				const holding =
					perception.adx > stats.range || (monster.attackCdT ?? 0) > 0;
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
					? { strikes: [monsterStrike(m, meleeHitbox(m), strike)] }
					: {},
		};
	};
}
