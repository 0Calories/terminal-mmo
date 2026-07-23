import { DEFAULT_MASS } from '../physics/constants';
import type { EntityType, MonsterType } from './types';

export const BOX = { w: 5, h: 5 } as const;

export interface MeleeProfile {
	damage: number;
	poise: number;
	range: number;
	aggro: number;
	deadzone: number;
	commitCd: number;
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
