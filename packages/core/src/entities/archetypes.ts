// Entity archetype tuning — the per-kind footprint plus exactly one data
// profile per Monster archetype (ADR 0032/0034: the scatter across world's
// spawnStats, combat's meleeProfileOf, and hardcoded shooter constants merges
// here; adding an archetype = adding a profile).

import { DEFAULT_MASS } from '../physics/constants';
import type { EntityType, MonsterType } from './types';

export const BOX = { w: 5, h: 5 } as const;

/** Tuning for a Melee committer's telegraphed swing and its approach envelope. */
export interface MeleeProfile {
	damage: number;
	poise: number;
	range: number;
	aggro: number;
	deadzone: number;
	commitCd: number;
}

/** The Projectile a ranged archetype fires. */
export interface ProjectileSpec {
	speed: number;
	life: number;
	damage: number;
	poise: number;
	knockback: number;
	knockbackUp: number;
}

/** Tuning for a ranged archetype's comfort band and fire cycle. */
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
	hp: 24,
	speed: 12,
	mass: DEFAULT_MASS,
	melee: {
		damage: 8,
		// Historically read COMBAT.poiseDamage (same value); owned here now —
		// retuning the avatar's poise damage no longer moves the chaser's.
		poise: 8,
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

// The single door to archetype tuning (ADR 0032 rejected two doors to one
// symbol): keyed lookup for factories/helpers, concrete member types for
// callers that read a specific archetype (e.g. ARCHETYPES.shooter.ranged).
export const ARCHETYPES = {
	chaser: CHASER,
	shooter: SHOOTER,
	brute: BRUTE,
} as const satisfies Record<MonsterType, ArchetypeProfile>;

export function meleeProfileOf(type: EntityType): MeleeProfile | null {
	if (type === 'player') return null;
	const p: ArchetypeProfile = ARCHETYPES[type];
	return p.melee ?? null;
}
