import { describe, expect, test } from 'bun:test';
import {
	COMBAT,
	DEFAULT_WEAPON,
	WEAPONS,
	type Weapon,
	weaponById,
	weaponSwingTotal,
} from '../src';

describe('WEAPONS catalog', () => {
	test('the default weapon (index 0) matches the pre-weapon COMBAT defaults', () => {
		// An Avatar with no weapon must play EXACTLY as before weapons existed, so the
		// default sword's stat block mirrors the shared COMBAT constants.
		const sword = WEAPONS[DEFAULT_WEAPON];
		expect(sword.damage).toBe(COMBAT.meleeDamage);
		expect(sword.reach).toBe(COMBAT.meleeReach);
		expect(sword.poiseDamage).toBe(COMBAT.poiseDamage);
		expect(sword.knockback).toBe(COMBAT.knockback);
		expect(sword.knockbackUp).toBe(COMBAT.knockbackUp);
		expect(sword.swing).toEqual(COMBAT.swing);
	});

	test('a greatsword is slower and heavier than a dagger from data alone', () => {
		const great = WEAPONS.find((w) => w.name === 'Greatsword') as Weapon;
		const dagger = WEAPONS.find((w) => w.name === 'Dagger') as Weapon;
		// Phase timing: the greatsword commits longer end-to-end than the dagger.
		expect(weaponSwingTotal(great)).toBeGreaterThan(weaponSwingTotal(dagger));
		// Hit-reaction: the greatsword hits harder and staggers far more.
		expect(great.damage).toBeGreaterThan(dagger.damage);
		expect(great.poiseDamage).toBeGreaterThan(dagger.poiseDamage);
		expect(great.knockback).toBeGreaterThan(dagger.knockback);
		expect(great.reach).toBeGreaterThan(dagger.reach);
	});
});

describe('weaponById', () => {
	test('resolves a catalog index to its stat block', () => {
		expect(weaponById(DEFAULT_WEAPON)).toBe(WEAPONS[DEFAULT_WEAPON]);
	});

	test('clamps an absent / out-of-range / forward-version index to the default', () => {
		expect(weaponById(undefined)).toBe(WEAPONS[DEFAULT_WEAPON]);
		expect(weaponById(999)).toBe(WEAPONS[DEFAULT_WEAPON]);
		expect(weaponById(-1)).toBe(WEAPONS[DEFAULT_WEAPON]);
	});
});
