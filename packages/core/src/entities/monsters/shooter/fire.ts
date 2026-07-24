import type { Drive } from '../../../physics/physics';
import type { CombatEngine, EngineMemory } from '../shared';
import { toward } from '../shared';

export interface FireShape {
	/** The near edge of the comfort band: no shot is released inside it. */
	keepDist: number;
}

export interface FireMemory extends EngineMemory {
	kind: 'fire';

	settling: boolean;
}

// Backing out stops a margin beyond the band edge, so a target drifting along
// it cannot flip the shooter between retreating and firing every tick.
const SETTLE_MARGIN = 2;

function fireMemory(memory: EngineMemory | undefined): FireMemory | null {
	return memory?.kind === 'fire' ? (memory as FireMemory) : null;
}

/** Ranged pattern: hold a comfort band, back out of it, shoot from inside it. */
export function fireEngine(shape: FireShape): CombatEngine {
	return {
		fight: ({ monster, view, perception, movement, memory }) => {
			const face = toward(perception.dx);
			const settling = fireMemory(memory.combat)?.settling ?? false;
			const settleAt = shape.keepDist + (settling ? SETTLE_MARGIN : 0);
			if (perception.adx < settleAt) {
				const retreat = perception.dx > 0 ? -1 : 1;
				const destX = (perception.targetX ?? monster.x) + retreat * settleAt;
				const step = movement.moveToward(monster, view, destX, memory.movement);
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
	};
}
