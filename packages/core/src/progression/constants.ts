import type { EntityType } from '../entities/types';

export const PROGRESSION = {
	levelCap: 5,
	xpBase: 60,
	xpGrowth: 2,
	baseHp: 100,
	hpPerLevel: 25,
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
