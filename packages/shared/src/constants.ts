import type { EntityType } from './types';

export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

export const BOX = { w: 5, h: 5 } as const;

export const NPC_BOX = { w: 4, h: BOX.h } as const; // must match world.ts's Merchant footprint
export const PORTAL_BOX = { w: 4, h: 7 } as const; // must match world.ts's portal dims

export const PHYS = {
	speed: 22,
	jump: 34,
	grav: 90,
	maxDt: 0.05,
	drag: 8,
	impulseEpsilon: 0.01,
} as const;

export const DEFAULT_MASS = 1;

export const COMBAT = {
	meleeReach: 6,
	meleeDamage: 8,
	swing: { windup: 0.1, active: 0.12, recovery: 0.16 },
	iframes: 0.6,
	dodge: { active: 0.18, recovery: 0.22, impulse: 90, up: 10, cooldown: 0.8 },
	poiseDamage: 8,
	hitstun: 0.35,
	knockback: 40,
	knockbackUp: 14,
	poise: { max: 16, regen: 12, regenDelay: 0.6 } as const,
	guard: {
		blockChip: 0.25,
		blockPoise: 6,
		heldClamp: 1,
	} as const,
	deathBurstIntensity: 30,
} as const;

export const MONSTER = {
	chaserHp: 24,
	chaserSpeed: 12,
	chaserAggro: 22,
	chaserDeadzone: 2,
	meleeDamage: 8,
	meleeRange: 4,
} as const;

export const BRUTE = {
	hp: 60,
	speed: 6,
	aggro: 26,
	deadzone: 2,
	mass: 4,
	poiseMax: 48,
	meleeDamage: 18,
	meleePoise: 16,
	meleeRange: 5,
	commitCooldown: 1.6,
} as const;

export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46,
	keepDist: 20,
	fireCooldown: 1.4,
	projSpeed: 30,
	projLife: 2.4,
	projDamage: 7,
	projPoise: 6,
	projKnockback: 30,
	projKnockbackUp: 10,
} as const;

export const PROJECTILE = { w: 1, h: 1 } as const;

export const PROGRESSION = {
	levelCap: 5,
	xpBase: 60,
	xpGrowth: 2,
	baseHp: 100,
	hpPerLevel: 25,
} as const;

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const;

export const TOWN = { w: 80 } as const;

export const ZONE_MAX = { w: 2000, h: 200 } as const;

export const TOWN_SPAWN = { x: 12, y: GROUND_TOP - BOX.h } as const;

export const RESPAWN = { delaySec: 5 } as const;

export const LOOT = {
	pickup: { w: BOX.w + 4, h: BOX.h },
	ttlSec: 30,
} as const;

export const MONSTER_XP: Record<EntityType, number> = {
	player: 0,
	chaser: 5,
	shooter: 8,
	brute: 14,
} as const;

export const ZONE_XP_MULT: Record<string, number> = {
	'field-01': 1,
	'field-02': 1.5,
	'field-03': 2,
	'dungeon-01': 2.5,
} as const;

export const CHAT_MAX_LEN = 120;
