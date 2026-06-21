import { PROGRESSION } from './constants';
import type { PlayerProgress } from './types';

// Infinity at the cap, so the level-up loop can never advance past it.
export function xpToNext(level: number): number {
	if (level >= PROGRESSION.levelCap) return Infinity;
	return 20 + level * level * 4;
}

export function maxHpForLevel(level: number): number {
	return 80 + (level - 1) * 12;
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
