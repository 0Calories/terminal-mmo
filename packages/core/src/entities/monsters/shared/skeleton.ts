import { type Drive, IDLE_DRIVE } from '../../../physics/physics';
import type { Brain, BrainResult, BrainView } from '../../brain';
import type { Entity, Facing } from '../../types';

export type MonsterState = 'patrol' | 'combat';

/** One kind-tagged slice per Combat engine; only its own engine narrows it. */
export interface CombatMemory {
	kind: string;
}

export interface MonsterMemory {
	state: MonsterState;

	combat?: CombatMemory;
}

export interface Perception {
	targetX: number | null;

	/** Signed gap to the target; 0 without one. */
	dx: number;

	/** Distance to the target; Infinity without one. */
	adx: number;

	inVision: boolean;
}

export interface MovementEngine {
	wander(m: Entity, view: BrainView): Drive;

	moveToward(m: Entity, view: BrainView, destX: number): Drive;
}

export interface CombatContext {
	monster: Entity;
	view: BrainView;
	perception: Perception;
	movement: MovementEngine;

	/** The engine's own memory slice, as it left it last tick. */
	memory?: CombatMemory;
}

export interface CombatDecision {
	drive: Drive;

	memory?: CombatMemory;
}

export interface CombatEngine {
	fight(ctx: CombatContext): CombatDecision;
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
		if (!perception.inVision)
			return {
				drive: spec.movement.wander(m, view),
				ai: { state: 'patrol' },
			};

		const decision = spec.combat.fight({
			monster: m,
			view,
			perception,
			movement: spec.movement,
			memory: memory.combat,
		});
		return {
			drive: decision.drive,
			ai: decision.memory
				? { state: 'combat', combat: decision.memory }
				: { state: 'combat' },
		};
	};
}
