import { expect, test } from 'bun:test';
import { applyXp, maxHpForLevel, PROGRESSION, xpToNext } from '../src';

test('xpToNext rises with level and is infinite at the cap', () => {
	expect(xpToNext(1)).toBe(24);
	expect(xpToNext(2)).toBe(36);
	expect(xpToNext(PROGRESSION.levelCap)).toBe(Infinity);
});

test('applyXp levels up when the threshold is met', () => {
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, 24);
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
	expect(maxHpForLevel(1)).toBe(80);
	expect(maxHpForLevel(2)).toBe(92);
});
