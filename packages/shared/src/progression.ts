import { PROGRESSION } from './constants';
import type { PlayerProgress } from './types';

// EXP to advance from `level` to the next — a gentle arithmetic ramp (`xpBase * level`),
// so each rung costs `xpBase` more than the last (40 / 80 / 120 / 160, 400 total to the
// cap). Tuned for the five-level demo arc so the Dungeon faucet is a sane, reliable
// climb (ADR 0024 §5, amendment §3). Infinity at the cap, so the level-up loop can
// never advance past it.
export function xpToNext(level: number): number {
	if (level >= PROGRESSION.levelCap) return Infinity;
	return PROGRESSION.xpBase * level;
}

// Per-level max HP: survivability is the level's baseline reward, rising linearly off a
// level-1 base and doubling by the cap. Raw attack power is NOT scaled here — it arrives
// as the level-gated verbs (see the capability ladder below), keeping the Weapon the one
// damage stat (ADR 0024 §8).
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

// --- Capability ladder (ADR 0024 §5) ----------------------------------------

// Each level hands the Player exactly one new verb, paced to arrive just before the
// world demands it. This map is the single source of truth for level-gating: the
// Warrior skills read their unlock level from it, and combat gates block/dodge on it —
// so the ladder can never drift between the two subsystems.
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
