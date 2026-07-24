import { meleeActive, SWING_TOTAL, swingPhase } from '../../../combat/combat';
import { COMBAT } from '../../../combat/constants';
import type { ProjectileSpec } from '../../../combat/projectile';
import { spawnProjectile } from '../../../combat/projectile';
import type { Drive } from '../../../physics/physics';
import type { CombatBuild, CombatEngine, EngineMemory } from '../shared';
import { toward } from '../shared';

/** The ballistics of a shot, less the damage its shooter's sheet decides. */
export type ProjectileShape = Omit<ProjectileSpec, 'damage'>;

export interface FireShape {
	/** Cooldown a released shot starts. */
	cooldown: number;

	projectile: ProjectileShape;
}

/** Fire's founding monster is the shooter. */
export const FIRE_DEFAULTS: FireShape = {
	cooldown: 1.4,
	projectile: {
		speed: 30,
		life: 2.4,
		poiseDamage: 6,
		knockback: 30,
		knockbackUp: 10,
	},
};

/** The ballistics the pre-poise wire format left implicit. */
export const PROJECTILE_DEFAULTS: ProjectileShape = FIRE_DEFAULTS.projectile;

export interface FireMemory {
	kind: 'fire';

	settling: boolean;
}

// Backing out stops a margin beyond the band edge, so a target drifting along
// it cannot flip the shooter between retreating and firing every tick.
const SETTLE_MARGIN = 2;

function fireMemory(memory: EngineMemory | undefined): FireMemory | null {
	return memory?.kind === 'fire' ? memory : null;
}

export interface FireOverrides {
	cooldown?: number;
	projectile?: Partial<ProjectileShape>;
}

/** Ranged pattern: hold a comfort band, back out of it, shoot from inside it. */
export function fireEngine(overrides: FireOverrides = {}): CombatBuild {
	const shape: FireShape = {
		cooldown: overrides.cooldown ?? FIRE_DEFAULTS.cooldown,
		projectile: { ...FIRE_DEFAULTS.projectile, ...overrides.projectile },
	};
	return (stats): CombatEngine => {
		const keepDist = stats.range;
		const spec: ProjectileSpec = {
			...shape.projectile,
			damage: stats.damage,
		};
		return {
			timings: COMBAT.swing,

			fight: ({ monster, view, perception, movement, memory }) => {
				const face = toward(perception.dx);
				const settling = fireMemory(memory.combat)?.settling ?? false;
				const settleAt = keepDist + (settling ? SETTLE_MARGIN : 0);
				if (perception.adx < settleAt) {
					const retreat = perception.dx > 0 ? -1 : 1;
					const destX = (perception.targetX ?? monster.x) + retreat * settleAt;
					const step = movement.moveToward(
						monster,
						view,
						destX,
						memory.movement,
					);
					return {
						drive: { ...step.drive, face },
						memory: { kind: 'fire', settling: true },
						movement: step.memory,
					};
				}
				const drive: Drive = { moveX: 0, jump: false, face };
				const settled: FireMemory = { kind: 'fire', settling: false };
				if ((monster.attackCdT ?? 0) > 0) return { drive, memory: settled };
				return { drive: { ...drive, commit: 'fire' }, memory: settled };
			},

			commit: (m) => ({ ...m, attackT: SWING_TOTAL }),

			// The shot leaves on the edge into the active window, so a commit
			// releases exactly one projectile however long the window runs.
			project: (m, { attackTBefore, nextProjectileId }) =>
				swingPhase(attackTBefore) !== 'active' && meleeActive(m.attackT)
					? {
							shots: [spawnProjectile(nextProjectileId, m, m.facing, spec)],
							monster: { ...m, attackCdT: shape.cooldown },
						}
					: {},
		};
	};
}
