import { fillRatio } from './bars';
import { MONSTER_XP, PROGRESSION, ZONE_XP_MULT } from './constants';
import type { EntityType, PlayerProgress } from './types';

// EXP to advance from `level` to the next — a geometric ramp (`xpBase * xpGrowth^(L-1)`),
// doubling each rung (60 / 120 / 240 / 480, 900 to cap). Infinity at the cap, so the
// level-up loop can never advance past it (#266).
export function xpToNext(level: number): number {
	if (level >= PROGRESSION.levelCap) return Infinity;
	return PROGRESSION.xpBase * PROGRESSION.xpGrowth ** (level - 1);
}

// XP a kill awards each contributor: the Monster's base worth (MONSTER_XP) scaled by the
// Zone depth multiplier (ZONE_XP_MULT), floored. Unknown Monster or Zone falls back to
// 0 / ×1 rather than crashing (#266).
export function xpForKill(monster: EntityType, zoneId: string): number {
	return Math.floor((MONSTER_XP[monster] ?? 0) * (ZONE_XP_MULT[zoneId] ?? 1));
}

// Per-level max HP: survivability is the level's baseline reward. Raw attack power is
// not scaled here — it arrives as gated verbs, keeping the Weapon the one damage stat (ADR 0024 §8).
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

// The XP bar's state for the HUD (#243). At the cap there is no next level, so `needed`
// is 0 and the bar reads full (`ratio: 1`) rather than a divide-by-Infinity gap.
export interface XpProgress {
	current: number; // XP banked toward the next level
	needed: number; // XP required to reach it (0 at the cap)
	ratio: number; // fill fraction [0,1]; 1 at the cap
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

// --- Capability ladder (ADR 0024 §5) ----------------------------------------

// Each level hands the Player one new verb. Warrior skills read their unlock level from
// this map and combat gates block/dodge on it, so the two can't drift.
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
