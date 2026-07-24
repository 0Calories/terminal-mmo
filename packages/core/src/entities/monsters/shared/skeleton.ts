import { type Drive, IDLE_DRIVE } from '../../../physics/physics';
import type {
	AttackPhaseTimings,
	Entity,
	Facing,
	Projectile,
	Strike,
	Terrain,
} from '../../types';
import type { FireMemory } from '../shooter/fire';
import type { HopMemory } from '../slime/hop';

export interface BrainView {
	terrain: Terrain;

	targetX: number | null;
}

export interface BrainResult {
	drive: Drive;

	ai: MonsterMemory;
}

export type Brain = (m: Entity, view: BrainView) => BrainResult;

export type MonsterState = 'patrol' | 'combat';

/**
 * Every engine's memory slice, tagged with the engine that narrows it. A slot
 * holds any of them, so each engine checks its own tag and falls back when the
 * slice it is handed belongs to someone else.
 */
export type EngineMemory = HopMemory | FireMemory;

export interface MonsterMemory {
	state: MonsterState;

	movement?: EngineMemory;

	combat?: EngineMemory;
}

/**
 * A monster's character sheet: the numbers that mean the same thing whichever
 * engines it composes, and so survive it swapping one for another.
 */
export interface MonsterStats {
	hp: number;
	speed: number;
	mass: number;

	/** Poise pool; unset leaves the shared one. */
	poise?: number;

	/** Damage a landed attack deals, however the attack is delivered. */
	damage: number;

	/** How far off the monster notices a target. */
	vision: number;

	/** Fighting distance, read by whichever Combat engine is composed: the
	 *  swing's strike threshold, the pounce's commit distance, the shooter's
	 *  keep-distance. */
	range: number;
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
	/** The phase timings the committed attack's timer runs on. */
	timings: AttackPhaseTimings;

	/** How hard a hit catching this attack mid-air swats it; unset means the
	 *  attack cannot be swatted. */
	swat?: number;

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

/** A character sheet with the two engines it configures. */
export interface MonsterComposition {
	stats: MonsterStats;
	movement: MovementEngine;
	combat: CombatEngine;
}

export interface MonsterSpec extends MonsterComposition {
	brain: Brain;
}

export const toward = (dx: number): Facing => (dx >= 0 ? 1 : -1);

const memoryOf = (ai: MonsterMemory | undefined): MonsterMemory =>
	ai ?? { state: 'patrol' };

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
export function skeletonBrain(spec: MonsterComposition): Brain {
	return (m, view): BrainResult => {
		const memory = memoryOf(m.ai);
		if (stunned(m) || committed(m)) return { drive: IDLE_DRIVE, ai: memory };

		const perception = perceive(m, view, spec.stats.vision);
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
