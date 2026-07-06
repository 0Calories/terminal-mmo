import { expect, test } from 'bun:test';
import {
	applyXp,
	CAPABILITY_UNLOCK,
	type Capability,
	capabilityUnlocked,
	maxHpForLevel,
	PROGRESSION,
	xpToNext,
} from '../src';

test('xpToNext rises with level and is infinite at the cap', () => {
	// The reworked arithmetic ramp: xpBase * level (40 / 80 / 120 / 160 to the cap).
	expect(xpToNext(1)).toBe(40);
	expect(xpToNext(2)).toBe(80);
	expect(xpToNext(4)).toBe(160);
	expect(xpToNext(PROGRESSION.levelCap)).toBe(Infinity);
});

test('applyXp levels up when the threshold is met', () => {
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, xpToNext(1));
	expect(r.leveled).toBe(1);
	expect(r.progress.level).toBe(2);
	expect(r.progress.xp).toBe(0);
});

test('applyXp banks partial XP without leveling', () => {
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, 10);
	expect(r.leveled).toBe(0);
	expect(r.progress.xp).toBe(10);
});

test('applyXp rolls over multiple levels from one big grant', () => {
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, 1000);
	expect(r.progress.level).toBeGreaterThan(2);
	expect(r.leveled).toBe(r.progress.level - 1);
});

test('maxHpForLevel grows with level', () => {
	// Reworked survivability curve: base 100, +25/level, doubling by the cap.
	expect(maxHpForLevel(1)).toBe(100);
	expect(maxHpForLevel(2)).toBe(125);
	expect(maxHpForLevel(PROGRESSION.levelCap)).toBe(200);
});

test('the level cap is 5 and progression can never advance past it', () => {
	expect(PROGRESSION.levelCap).toBe(5);
	// A grant far larger than the whole curve stops dead at the cap, banking no overflow.
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, 1_000_000);
	expect(r.progress.level).toBe(PROGRESSION.levelCap);
	expect(r.progress.xp).toBe(0);
	// Already at the cap: more XP is inert — no further level, no banked xp.
	const capped = applyXp({ level: PROGRESSION.levelCap, xp: 0, gold: 0 }, 1_000_000);
	expect(capped.progress.level).toBe(PROGRESSION.levelCap);
	expect(capped.leveled).toBe(0);
	expect(capped.progress.xp).toBe(0);
});

test('the capability ladder hands exactly one new verb per level, in order', () => {
	// The demo's five-rung ladder (ADR 0024 §5): one verb per level, no gaps, no ties.
	expect(CAPABILITY_UNLOCK).toEqual({
		attack: 1,
		block: 2,
		'power-strike': 3,
		dodge: 4,
		'ground-pound': 5,
	});
	const levels = Object.values(CAPABILITY_UNLOCK).sort((a, b) => a - b);
	expect(levels).toEqual([1, 2, 3, 4, 5]); // one per level, 1..cap, none repeated
});

test('a fresh Avatar unlocks each capability in order as it levels to the cap', () => {
	const ladder: Capability[] = [
		'attack',
		'block',
		'power-strike',
		'dodge',
		'ground-pound',
	];
	// At each level 1..cap, exactly the verbs whose unlock is ≤ level are available, and
	// the newest is the one this level just handed over — a strictly widening kit.
	for (let level = 1; level <= PROGRESSION.levelCap; level++) {
		const unlocked = ladder.filter((cap) => capabilityUnlocked(cap, level));
		expect(unlocked).toEqual(ladder.slice(0, level));
		expect(CAPABILITY_UNLOCK[ladder[level - 1]]).toBe(level);
	}
	// Attack is available from spawn; the cap skill never is before the cap.
	expect(capabilityUnlocked('attack', 1)).toBe(true);
	expect(capabilityUnlocked('ground-pound', PROGRESSION.levelCap - 1)).toBe(false);
});
