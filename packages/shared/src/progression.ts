import { fillRatio } from './bars';
import { MONSTER_XP, PROGRESSION, ZONE_XP_MULT } from './constants';
import type { EntityType, PlayerProgress } from './types';

export function xpToNext(level: number): number {
	if (level >= PROGRESSION.levelCap) return Infinity;
	return PROGRESSION.xpBase * PROGRESSION.xpGrowth ** (level - 1);
}

export function xpForKill(monster: EntityType, zoneId: string): number {
	return Math.floor((MONSTER_XP[monster] ?? 0) * (ZONE_XP_MULT[zoneId] ?? 1));
}

export function maxHpForLevel(level: number): number {
	return PROGRESSION.baseHp + (level - 1) * PROGRESSION.hpPerLevel;
}

export function applyXp(
	p: PlayerProgress,
	amount: number,
): { progress: PlayerProgress; leveled: number } {
	let level = p.level;
	let xp = p.xp + amount;
	let leveled = 0;
	while (level < PROGRESSION.levelCap && xp >= xpToNext(level)) {
		xp -= xpToNext(level);
		level++;
		leveled++;
	}
	if (level >= PROGRESSION.levelCap) xp = 0;
	return { progress: { level, xp, gold: p.gold }, leveled };
}

export interface XpProgress {
	current: number;
	needed: number;
	ratio: number;
	atCap: boolean;
}

export function xpProgress(level: number, xp: number): XpProgress {
	const needed = xpToNext(level);
	if (!Number.isFinite(needed)) {
		return { current: 0, needed: 0, ratio: 1, atCap: true };
	}
	const current = Math.max(0, Math.min(xp, needed));
	return { current, needed, ratio: fillRatio(xp, needed), atCap: false };
}

// Combat gates and Warrior skills both read unlock levels from here — keep in sync.
export type Capability =
	| 'attack'
	| 'block'
	| 'power-strike'
	| 'dodge'
	| 'ground-pound';

export const CAPABILITY_UNLOCK: Record<Capability, number> = {
	attack: 1,
	block: 2,
	'power-strike': 3,
	dodge: 4,
	'ground-pound': 5,
};

export function capabilityUnlocked(cap: Capability, level: number): boolean {
	return level >= CAPABILITY_UNLOCK[cap];
}
