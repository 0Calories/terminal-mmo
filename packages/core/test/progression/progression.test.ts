import { describe, expect, test } from 'bun:test';
import {
	applyXp,
	CAPABILITY_UNLOCK,
	capabilityUnlocked,
	MONSTER_XP,
	maxHpForLevel,
	PROGRESSION,
	xpForKill,
	xpToNext,
	ZONE_XP_MULT,
} from '../../src/progression';

describe('configured progression laws', () => {
	test('XP thresholds follow the configured curve and become infinite at the cap', () => {
		const thresholds = Array.from(
			{ length: PROGRESSION.levelCap - 1 },
			(_, index) => xpToNext(index + 1),
		);
		for (const [index, threshold] of thresholds.entries()) {
			const level = index + 1;
			expect(threshold).toBe(
				PROGRESSION.xpBase * PROGRESSION.xpGrowth ** (level - 1),
			);
			if (index > 0) expect(threshold).toBeGreaterThan(thresholds[index - 1]);
		}
		expect(xpToNext(PROGRESSION.levelCap)).toBe(Number.POSITIVE_INFINITY);
	});

	test('kill XP is the configured monster reward scaled by configured Zone depth', () => {
		for (const [type, base] of Object.entries(MONSTER_XP)) {
			for (const [zoneId, multiplier] of Object.entries(ZONE_XP_MULT))
				expect(xpForKill(type as keyof typeof MONSTER_XP, zoneId)).toBe(
					Math.floor(base * multiplier),
				);
		}
		const unconfiguredZone = 'unconfigured-zone';
		for (const [type, base] of Object.entries(MONSTER_XP))
			expect(xpForKill(type as keyof typeof MONSTER_XP, unconfiguredZone)).toBe(
				base,
			);
	});

	test('the slime is the bottom rung of the reward ladder: lowest kill XP in the game', () => {
		for (const [type, base] of Object.entries(MONSTER_XP)) {
			if (type === 'slime' || type === 'player') continue;
			expect(MONSTER_XP.slime).toBeLessThan(base);
		}
		expect(MONSTER_XP.slime).toBeGreaterThan(0);
	});

	test('XP banks below a threshold, rolls over at it, and can cross several levels', () => {
		const start = { level: 1, xp: 0, gold: 7 };
		const firstThreshold = xpToNext(start.level);
		const cases = [
			{
				amount: firstThreshold - 1,
				assert: (result: ReturnType<typeof applyXp>) => {
					expect(result.leveled).toBe(0);
					expect(result.progress.xp).toBe(firstThreshold - 1);
				},
			},
			{
				amount: firstThreshold,
				assert: (result: ReturnType<typeof applyXp>) => {
					expect(result.leveled).toBe(1);
					expect(result.progress.level).toBe(start.level + 1);
					expect(result.progress.xp).toBe(0);
				},
			},
			{
				amount: firstThreshold + xpToNext(start.level + 1),
				assert: (result: ReturnType<typeof applyXp>) => {
					expect(result.leveled).toBe(2);
					expect(result.progress.level).toBe(start.level + 2);
				},
			},
		];
		for (const { amount, assert } of cases) {
			const result = applyXp(start, amount);
			assert(result);
			expect(result.progress.gold).toBe(start.gold);
		}
	});

	test('maximum HP follows its configured linear relation', () => {
		for (let level = 1; level <= PROGRESSION.levelCap; level++)
			expect(maxHpForLevel(level)).toBe(
				PROGRESSION.baseHp + (level - 1) * PROGRESSION.hpPerLevel,
			);
	});

	test('the level cap absorbs further XP and retains no banked overflow', () => {
		const result = applyXp(
			{ level: PROGRESSION.levelCap, xp: 0, gold: 0 },
			Number.MAX_SAFE_INTEGER,
		);
		expect(result.progress.level).toBe(PROGRESSION.levelCap);
		expect(result.progress.xp).toBe(0);
		expect(result.leveled).toBe(0);
	});

	test('every configured capability is locked below and unlocked at its rung', () => {
		for (const [capability, unlockLevel] of Object.entries(CAPABILITY_UNLOCK)) {
			expect(unlockLevel).toBeGreaterThanOrEqual(1);
			expect(unlockLevel).toBeLessThanOrEqual(PROGRESSION.levelCap);
			expect(
				capabilityUnlocked(
					capability as keyof typeof CAPABILITY_UNLOCK,
					unlockLevel,
				),
			).toBe(true);
			if (unlockLevel > 1)
				expect(
					capabilityUnlocked(
						capability as keyof typeof CAPABILITY_UNLOCK,
						unlockLevel - 1,
					),
				).toBe(false);
		}
	});
});
