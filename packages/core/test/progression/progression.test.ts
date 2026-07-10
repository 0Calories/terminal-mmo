import { expect, test } from 'bun:test';
import {
	applyXp,
	CAPABILITY_UNLOCK,
	type Capability,
	capabilityUnlocked,
	maxHpForLevel,
	PROGRESSION,
	xpForKill,
	xpToNext,
} from '../../src/progression';

test('xpToNext accelerates geometrically and is infinite at the cap', () => {
	expect(xpToNext(1)).toBe(60);
	expect(xpToNext(2)).toBe(120);
	expect(xpToNext(3)).toBe(240);
	expect(xpToNext(4)).toBe(480);
	expect(xpToNext(2) - xpToNext(1)).toBeLessThan(xpToNext(4) - xpToNext(3));
	expect(xpToNext(PROGRESSION.levelCap)).toBe(Infinity);
});

test('reaching the cap takes a tuned ~60-80 kills at the Dungeon faucet', () => {
	const perKill = xpForKill('chaser', 'dungeon-01');
	let p = { level: 1, xp: 0, gold: 0 };
	let kills = 0;
	while (p.level < PROGRESSION.levelCap) {
		p = applyXp(p, perKill).progress;
		kills++;
	}
	expect(kills).toBeGreaterThanOrEqual(60);
	expect(kills).toBeLessThanOrEqual(80);
});

test('xpForKill scales by monster archetype and zone depth', () => {
	expect(xpForKill('chaser', 'field-01')).toBeLessThan(
		xpForKill('shooter', 'field-01'),
	);
	expect(xpForKill('shooter', 'field-01')).toBeLessThan(
		xpForKill('brute', 'field-01'),
	);
	expect(xpForKill('chaser', 'field-01')).toBeLessThan(
		xpForKill('chaser', 'field-02'),
	);
	expect(xpForKill('chaser', 'field-02')).toBeLessThan(
		xpForKill('chaser', 'dungeon-01'),
	);
	// tuned values: archetype base × zone depth, floored
	expect(xpForKill('chaser', 'field-01')).toBe(5);
	expect(xpForKill('brute', 'field-03')).toBe(28);
	expect(xpForKill('chaser', 'dungeon-01')).toBe(12);
	expect(xpForKill('player', 'dungeon-01')).toBe(0);
	expect(xpForKill('chaser', 'town-01')).toBe(5);
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
	expect(maxHpForLevel(1)).toBe(100);
	expect(maxHpForLevel(2)).toBe(125);
	expect(maxHpForLevel(PROGRESSION.levelCap)).toBe(200);
});

test('the level cap is 5 and progression can never advance past it', () => {
	expect(PROGRESSION.levelCap).toBe(5);
	const r = applyXp({ level: 1, xp: 0, gold: 0 }, 1_000_000);
	expect(r.progress.level).toBe(PROGRESSION.levelCap);
	expect(r.progress.xp).toBe(0);
	const capped = applyXp(
		{ level: PROGRESSION.levelCap, xp: 0, gold: 0 },
		1_000_000,
	);
	expect(capped.progress.level).toBe(PROGRESSION.levelCap);
	expect(capped.leveled).toBe(0);
	expect(capped.progress.xp).toBe(0);
});

test('the capability ladder hands exactly one new verb per level, in order', () => {
	expect(CAPABILITY_UNLOCK).toEqual({
		attack: 1,
		block: 2,
		'power-strike': 3,
		dodge: 4,
		'ground-pound': 5,
	});
	const levels = Object.values(CAPABILITY_UNLOCK).sort((a, b) => a - b);
	expect(levels).toEqual([1, 2, 3, 4, 5]);
});

test('a fresh Avatar unlocks each capability in order as it levels to the cap', () => {
	const ladder: Capability[] = [
		'attack',
		'block',
		'power-strike',
		'dodge',
		'ground-pound',
	];
	for (let level = 1; level <= PROGRESSION.levelCap; level++) {
		const unlocked = ladder.filter((cap) => capabilityUnlocked(cap, level));
		expect(unlocked).toEqual(ladder.slice(0, level));
		expect(CAPABILITY_UNLOCK[ladder[level - 1]]).toBe(level);
	}
	expect(capabilityUnlocked('attack', 1)).toBe(true);
	expect(capabilityUnlocked('ground-pound', PROGRESSION.levelCap - 1)).toBe(
		false,
	);
});
