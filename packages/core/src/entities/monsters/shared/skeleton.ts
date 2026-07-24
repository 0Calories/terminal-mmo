import { type Drive, IDLE_DRIVE } from '../../../physics/physics';
import type { Brain, BrainResult, BrainView } from '../../brain';
import type { Entity, Facing, Projectile, Strike } from '../../types';

export type MonsterState = 'patrol' | 'combat';

/** An engine's own memory slice, tagged with the engine that narrows it. */
export interface EngineMemory {
	kind: string;
}

export interface MonsterMemory {
	state: MonsterState;

	movement?: EngineMemory;

	combat?: EngineMemory;
}

export interface Perception {
	targetX: number | null;

	/** Signed gap to the target; 0 without one. */
	dx: number;

	/** Distance to the target; Infinity without one. */
	adx: number;

	inVision: boolean;
}

export interface EngineStep {
	drive: Drive;

	/** The producing engine's own slice, absent when the engine keeps none. */
	memory?: EngineMemory;
}

export interface MovementEngine {
	wander(m: Entity, view: BrainView, memory?: EngineMemory): EngineStep;

	moveToward(
		m: Entity,
		view: BrainView,
		destX: number,
		memory?: EngineMemory,
	): EngineStep;
}

export interface CombatContext {
	monster: Entity;
	view: BrainView;
	perception: Perception;
	movement: MovementEngine;
	memory: MonsterMemory;
}

export interface CombatStep extends EngineStep {
	/** The slice returned by the Movement engine this fight commissioned. */
	movement?: EngineMemory;
}

export interface ProjectionContext {
	/** The attack timer as it stood at the top of the tick, before its decay. */
	attackTBefore: number;

	/** The id the first shot of this projection takes. */
	nextProjectileId: number;
}

export interface AttackProjection {
	/** The monster after the projection's own bookkeeping; absent leaves it. */
	monster?: Entity;

	strikes?: Strike[];

	shots?: Projectile[];
}

/**
 * The execution half of a Combat engine: what the zone tick does around
 * stepping a monster that has committed this engine's attack. The tick calls
 * every hook the same way for every monster and never names an attack.
 */
export interface CombatExecution {
	/** The drive a committed attack takes the body over with; null leaves the
	 *  Brain's own drive standing. */
	committedDrive?(m: Entity): Drive | null;

	/** The timers a commit starts. */
	commit?(m: Entity): Entity;

	/** What the finished step forces on the attack timer. */
	afterStep?(m: Entity): Entity;

	/** The Strikes and shots this tick's phase projects. */
	project?(m: Entity, ctx: ProjectionContext): AttackProjection;
}

export interface CombatEngine extends CombatExecution {
	fight(ctx: CombatContext): CombatStep;
}

export interface MonsterSpec {
	vision: number;
	movement: MovementEngine;
	combat: CombatEngine;
}

export const toward = (dx: number): Facing => (dx >= 0 ? 1 : -1);

function memoryOf(ai: unknown): MonsterMemory {
	return typeof ai === 'object' && ai !== null && 'state' in ai
		? (ai as MonsterMemory)
		: { state: 'patrol' };
}

function perceive(m: Entity, view: BrainView, vision: number): Perception {
	const { targetX } = view;
	if (targetX === null)
		return { targetX, dx: 0, adx: Number.POSITIVE_INFINITY, inVision: false };
	const dx = targetX - m.x;
	const adx = Math.abs(dx);
	return { targetX, dx, adx, inVision: adx < vision };
}

const stunned = (m: Entity) => (m.stunT ?? 0) > 0;
const committed = (m: Entity) => m.attackT > 0;

/**
 * The one Patrol/Combat state machine: gates → perceive → transition →
 * delegate. Only this function reads or writes the state; the engines it
 * delegates to are handed the perception and never touch memory.
 */
export function skeletonBrain(spec: MonsterSpec): Brain {
	return (m, view): BrainResult => {
		const memory = memoryOf(m.ai);
		if (stunned(m) || committed(m)) return { drive: IDLE_DRIVE, ai: memory };

		const perception = perceive(m, view, spec.vision);
		const state: MonsterState = perception.inVision ? 'combat' : 'patrol';
		if (state === 'patrol') {
			const step = spec.movement.wander(m, view, memory.movement);
			// A gait is continuous across the transition, but a fight is not: the
			// combat slice is dropped so the next one starts from a clean sheet.
			const movement = step.memory ?? memory.movement;
			return {
				drive: step.drive,
				ai: movement ? { state, movement } : { state },
			};
		}
		const step = spec.combat.fight({
			monster: m,
			view,
			perception,
			movement: spec.movement,
			memory,
		});
		return {
			drive: step.drive,
			ai: {
				...memory,
				state,
				movement: step.movement ?? memory.movement,
				combat: step.memory ?? memory.combat,
			},
		};
	};
}
