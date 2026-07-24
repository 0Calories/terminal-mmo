import { attackPhaseAt, attackTotal, entityBox } from '../../../combat/combat';
import type { Drive } from '../../../physics/physics';
import { IDLE_DRIVE } from '../../../physics/physics';
import type { AttackPhaseTimings, Entity } from '../../types';
import type { CombatEngine, MeleeStrikeShape } from '../shared';
import { monsterStrike, toward } from '../shared';

export interface PounceShape {
	/** Distance the leap crosses, so the distance it commits from. */
	range: number;

	/** Cooldown a commit starts. */
	cooldown: number;

	/** Phase timings the committed leap runs on. */
	timings: AttackPhaseTimings;

	/** Leap velocity, as scales over ground speed and the shared jump impulse. */
	leap: { speed: number; jump: number };

	strike: MeleeStrikeShape;
}

/**
 * Leaping attack: the approach closes only to the lip of leap range and the
 * commit is made from a standstill, so the wind-up starts at pouncing distance
 * rather than on top of the target.
 */
export function pounceEngine(shape: PounceShape): CombatEngine {
	const lip = shape.range - 1;
	const leaping = (m: Entity) =>
		attackPhaseAt(m.attackT, shape.timings) === 'active';

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

		// A committed pounce owns the body: the squash and the wobble stand still,
		// and the leap launches on the first active tick then rides its locked
		// ballistic arc.
		committedDrive: (m) =>
			m.attackT <= 0
				? null
				: leaping(m)
					? {
							moveX: m.facing,
							jump: m.onGround,
							moveScale: shape.leap.speed,
							jumpScale: shape.leap.jump,
						}
					: IDLE_DRIVE,

		commit: (m) => ({
			...m,
			attackT: attackTotal(shape.timings),
			attackCdT: shape.cooldown,
			swingHits: [],
		}),

		// Touching down cuts the active window short: landing IS the start of the
		// wobble recovery, however early the arc ended.
		afterStep: (m) =>
			m.onGround && leaping(m) ? { ...m, attackT: shape.timings.recovery } : m,

		project: (m) =>
			leaping(m) && !m.onGround
				? { strikes: [monsterStrike(m, entityBox(m), shape.strike)] }
				: {},
	};
}
