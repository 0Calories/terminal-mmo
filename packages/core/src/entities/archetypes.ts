import { DEFAULT_MASS, PHYS } from '../physics/constants';
import type { AttackPhaseTimings, EntityType, MonsterType } from './types';

export const BOX = { w: 5, h: 5 } as const;

export interface MeleeProfile {
	damage: number;
	poise: number;
	range: number;
	aggro: number;
	deadzone: number;
	commitCd: number;

	/** Scales the Strike impulse; unset leaves the shared knockback untouched. */
	knockback?: number;

	/**
	 * Present on leapers: the commit is a pounce — grounded wind-up, a flat
	 * lunge locked at commit whose whole airborne arc is the active hitbox, and
	 * a landing-wobble recovery. Absent, the commit is a standard swing.
	 */
	pounce?: PounceProfile;
}

export interface PounceProfile extends AttackPhaseTimings {
	/** Leap velocity, as scales over ground speed and the shared jump impulse. */
	leap: { speed: number; jump: number };

	/** Scales the attacker's knockback when a hit swats the leap mid-air. */
	swat: number;
}

export interface ProjectileSpec {
	speed: number;
	life: number;
	damage: number;
	poise: number;
	knockback: number;
	knockbackUp: number;
}

export interface RangedProfile {
	aggro: number;
	keepDist: number;
	fireCooldown: number;
	projectile: ProjectileSpec;
}

export interface ArchetypeProfile {
	hp: number;
	speed: number;
	mass: number;
	poiseMax?: number;
	melee?: MeleeProfile;
	ranged?: RangedProfile;
}

const CHASER = {
	hp: 32,
	speed: 13,
	mass: DEFAULT_MASS,
	melee: {
		damage: 11,
		poise: 10,
		range: 4,
		aggro: 22,
		deadzone: 2,
		commitCd: 0,
	},
} as const satisfies ArchetypeProfile;

// A full hop stays airborne for 2·jump/grav seconds; the leap's jump scale
// shrinks that proportionally, and the active window pads it with a landing
// tick so the arc is hitbox-live end to end.
const HOP_AIRTIME = (2 * PHYS.jump) / PHYS.grav;

const SLIME_LEAP = { speed: 2.6, jump: 0.55 } as const;

const SLIME = {
	hp: 24,
	speed: 12,
	mass: 0.85,
	melee: {
		damage: 8,
		poise: 8,
		// Leap-sized: the flat lunge's ground coverage (scaled speed × airtime),
		// so an edge-of-range target gets landed on rather than overshot.
		range: 13,
		aggro: 22,
		deadzone: 2,
		commitCd: 2,
		knockback: 2.6,
		pounce: {
			windup: 0.45,
			active: HOP_AIRTIME * SLIME_LEAP.jump + 0.05,
			recovery: 0.5,
			leap: SLIME_LEAP,
			swat: 2.2,
		},
	},
} as const satisfies ArchetypeProfile;

const BRUTE = {
	hp: 60,
	speed: 6,
	mass: 4,
	poiseMax: 48,
	melee: {
		damage: 18,
		poise: 16,
		range: 5,
		aggro: 26,
		deadzone: 2,
		commitCd: 1.6,
	},
} as const satisfies ArchetypeProfile;

const SHOOTER = {
	hp: 16,
	speed: 9,
	mass: DEFAULT_MASS,
	ranged: {
		aggro: 46,
		keepDist: 20,
		fireCooldown: 1.4,
		projectile: {
			speed: 30,
			life: 2.4,
			damage: 7,
			poise: 6,
			knockback: 30,
			knockbackUp: 10,
		},
	},
} as const satisfies ArchetypeProfile;

export const ARCHETYPES = {
	slime: SLIME,
	chaser: CHASER,
	shooter: SHOOTER,
	brute: BRUTE,
} as const satisfies Record<MonsterType, ArchetypeProfile>;

function profileOf(type: EntityType): ArchetypeProfile | null {
	return type === 'player' ? null : ARCHETYPES[type];
}

export function meleeProfileOf(type: EntityType): MeleeProfile | null {
	return profileOf(type)?.melee ?? null;
}

export function rangedProfileOf(type: EntityType): RangedProfile | null {
	return profileOf(type)?.ranged ?? null;
}
