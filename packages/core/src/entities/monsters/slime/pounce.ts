import { attackPhaseAt, attackTotal, entityBox } from '../../../combat/combat';
import { PHYS } from '../../../physics/constants';
import type { Drive } from '../../../physics/physics';
import { IDLE_DRIVE } from '../../../physics/physics';
import type { AttackPhaseTimings, Entity } from '../../types';
import type { CombatBuild, CombatEngine, MeleeStrikeShape } from '../shared';
import { monsterStrike, toward } from '../shared';

export interface PounceShape {
	/** Cooldown a commit starts. */
	cooldown: number;

	/** Phase timings the committed leap runs on. */
	timings: AttackPhaseTimings;

	/** Leap velocity, as scales over ground speed and the shared jump impulse. */
	leap: { speed: number; jump: number };

	/** Scales the attacker's knockback when a hit swats the leap mid-air. */
	swat: number;

	poiseDamage: number;

	/** Scales the Strike impulse over the shared melee knockback. */
	knockback: number;
}

// A full hop stays airborne for 2·jump/grav seconds; the leap's jump scale
// shrinks that proportionally, and the active window pads it with a landing
// tick so the arc is hitbox-live end to end.
const HOP_AIRTIME = (2 * PHYS.jump) / PHYS.grav;

const LEAP = { speed: 2.6, jump: 0.55 } as const;

/** Pounce's founding monster is the slime. */
export const POUNCE_DEFAULTS: PounceShape = {
	cooldown: 2,
	timings: {
		windup: 0.45,
		active: HOP_AIRTIME * LEAP.jump + 0.05,
		recovery: 0.5,
	},
	leap: LEAP,
	swat: 2.2,
	poiseDamage: 8,
	knockback: 2.6,
};

/**
 * Leaping attack: the approach closes only to the lip of leap range and the
 * commit is made from a standstill, so the wind-up starts at pouncing distance
 * rather than on top of the target.
 */
export function pounceEngine(
	overrides: Partial<PounceShape> = {},
): CombatBuild {
	const shape: PounceShape = { ...POUNCE_DEFAULTS, ...overrides };
	const leaping = (m: Entity) =>
		attackPhaseAt(m.attackT, shape.timings) === 'active';

	return (stats): CombatEngine => {
		// The whole airborne body is the hitbox, so a leap committed at range
		// crosses its target; the approach stops one column short of that lip.
		const lip = stats.range - 1;
		const strike: MeleeStrikeShape = {
			damage: stats.damage,
			poiseDamage: shape.poiseDamage,
			knockback: shape.knockback,
		};

		return {
			timings: shape.timings,
			swat: shape.swat,

			fight: ({ monster, view, perception, movement, memory }) => {
				const ready =
					monster.onGround &&
					perception.adx <= stats.range &&
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

			// A committed pounce owns the body: the squash and the wobble stand
			// still, and the leap launches on the first active tick then rides its
			// locked ballistic arc.
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
				m.onGround && leaping(m)
					? { ...m, attackT: shape.timings.recovery }
					: m,

			project: (m) =>
				leaping(m) && !m.onGround
					? { strikes: [monsterStrike(m, entityBox(m), strike)] }
					: {},
		};
	};
}
