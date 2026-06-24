import { describe, expect, test } from 'bun:test';
import {
	type MovesetAbilityId,
	movesetForClass,
	movesetUnlocked,
	WARRIOR_MOVESET,
} from '../src';

// The canonical unlock order (#170): string extensions → Launcher → aerials → Spike →
// cancels → Parry. Parry is the earned capstone, so it sits last.
const ORDER: MovesetAbilityId[] = [
	'string-extensions',
	'launcher',
	'aerials',
	'spike',
	'cancels',
	'parry',
];

describe('Warrior Moveset unlock curve (#170)', () => {
	test('the curve lists every ability in the canonical unlock order', () => {
		expect(WARRIOR_MOVESET.map((a) => a.id)).toEqual(ORDER);
	});

	test('unlock levels strictly ascend, so the curve reads as the order it unlocks in', () => {
		for (let i = 1; i < WARRIOR_MOVESET.length; i++)
			expect(WARRIOR_MOVESET[i].unlockLevel).toBeGreaterThan(
				WARRIOR_MOVESET[i - 1].unlockLevel,
			);
	});

	test('Parry is the last unlock (an earned defensive verb, not a level-1 gift)', () => {
		const parry = WARRIOR_MOVESET.find((a) => a.id === 'parry');
		const maxLevel = Math.max(...WARRIOR_MOVESET.map((a) => a.unlockLevel));
		expect(parry?.unlockLevel).toBe(maxLevel);
		expect(parry?.unlockLevel).toBeGreaterThan(1);
	});

	test('movesetForClass returns the Warrior curve', () => {
		expect(movesetForClass('warrior')).toBe(WARRIOR_MOVESET);
	});
});

describe('movesetUnlocked gating', () => {
	test('an ability is locked below its level and unlocked at/above it', () => {
		for (const ability of WARRIOR_MOVESET) {
			expect(movesetUnlocked(ability.id, ability.unlockLevel - 1)).toBe(false);
			expect(movesetUnlocked(ability.id, ability.unlockLevel)).toBe(true);
			expect(movesetUnlocked(ability.id, ability.unlockLevel + 5)).toBe(true);
		}
	});

	test('the level-1 floor: NO Moveset ability is unlocked at level 1', () => {
		// basic attack + Block + Dodge only — every gated verb (incl. Parry) is locked.
		for (const ability of WARRIOR_MOVESET)
			expect(movesetUnlocked(ability.id, 1)).toBe(false);
	});

	test('defaults to the Warrior curve when no class is given', () => {
		const parryLevel = WARRIOR_MOVESET.find((a) => a.id === 'parry')
			?.unlockLevel as number;
		expect(movesetUnlocked('parry', parryLevel)).toBe(true);
		expect(movesetUnlocked('parry', parryLevel - 1)).toBe(false);
	});
});
