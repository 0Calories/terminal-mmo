import type { Drive } from '../../../physics/physics';
import type { CombatEngine } from '../shared';
import { toward } from '../shared';

export interface PounceShape {
	/** Distance the leap crosses, so the distance it commits from. */
	range: number;
}

/**
 * Leaping attack: the approach closes only to the lip of leap range and the
 * commit is made from a standstill, so the wind-up starts at pouncing distance
 * rather than on top of the target.
 */
export function pounceEngine(shape: PounceShape): CombatEngine {
	const lip = shape.range - 1;
	return {
		fight: ({ monster, view, perception, movement, memory }) => {
			const ready =
				monster.onGround &&
				perception.adx <= shape.range &&
				(monster.attackCdT ?? 0) <= 0;
			const destX =
				ready || perception.adx <= lip
					? monster.x
					: (perception.targetX ?? monster.x) + toward(perception.dx) * -lip;
			const step = movement.moveToward(monster, view, destX, memory.movement);

			const drive: Drive = { ...step.drive };
			// A travelling hop keeps the heading it launched with; standing still is
			// the moment to square up on the target.
			if (drive.moveX === 0) drive.face = toward(perception.dx);
			if (ready) drive.commit = 'pounce';
			return { drive, movement: step.memory };
		},
	};
}
