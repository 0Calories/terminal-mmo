import { describe, expect, test } from 'bun:test';
import {
	COMBAT,
	DEFAULT_WEAPON,
	WEAPON_ACCENT_KEY,
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

	test('greatsword and dagger each author a full WeaponSprite frame set (#184)', () => {
		// A new weapon is DATA, not code: each references a WeaponSprite with the full
		// idle / windup / active-sweep / recovery set, a grip cell, and a distinct accent.
		const great = WEAPONS.find((w) => w.name === 'Greatsword') as Weapon;
		const dagger = WEAPONS.find((w) => w.name === 'Dagger') as Weapon;
		for (const w of [great, dagger]) {
			expect(w.sprite).toBeDefined();
			const f = w.sprite?.frames;
			expect(f?.idle).toBeDefined();
			expect(f?.windup).toBeDefined();
			expect(f?.recovery).toBeDefined();
			expect(f?.active?.length).toBeGreaterThan(0);
			// The accent is a real palette key, distinct from the dynamic-channel key the
			// blade cells carry (the renderer repaints `a` cells TO the accent colour).
			expect(w.sprite?.accent.length).toBe(1);
			expect(w.sprite?.accent).not.toBe(WEAPON_ACCENT_KEY);
		}
		// Each weapon carries its own accent — the three blades read apart by colour.
		const sword = WEAPONS[DEFAULT_WEAPON];
		const accents = [
			sword.sprite?.accent,
			great.sprite?.accent,
			dagger.sprite?.accent,
		];
		expect(new Set(accents).size).toBe(3);
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
