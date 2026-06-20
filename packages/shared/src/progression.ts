import { PROGRESSION } from './constants';
import type { PlayerProgress } from './types';

/** XP needed to go from `level` to `level + 1`. Infinite at the cap. */
export function xpToNext(level: number): number {
	if (level >= PROGRESSION.levelCap) return Infinity;
	return 20 + level * level * 4;
}

/** Max HP for a given level (levels give baseline power — ADR/PRD progression). */
export function maxHpForLevel(level: number): number {
	return 80 + (level - 1) * 12;
}

/** Apply XP, rolling over into as many levels as it earns (capped). Pure. */
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
