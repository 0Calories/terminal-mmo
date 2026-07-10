import { describe, expect, test } from 'bun:test';
import { COMBAT, DEFAULT_WEAPON, WEAPONS, weaponById } from '../src';

describe('WEAPONS catalog — name + damage + art reference (ADR 0024/0030/0031)', () => {
	test('the catalog is core-owned stats plus render-owned sprite references', () => {
		const allowed = new Set(['name', 'damage', 'sprite']);
		for (const w of WEAPONS) {
			for (const key of Object.keys(w)) expect(allowed).toContain(key);
			expect(typeof w.sprite).toBe('string');
			expect(w.sprite.length).toBeGreaterThan(0);
		}
		expect(WEAPONS[DEFAULT_WEAPON].damage).toBe(COMBAT.meleeDamage);
		expect(WEAPONS[DEFAULT_WEAPON].sprite).toBe('sword');
	});
});

describe('weaponById', () => {
	test('resolves valid ids and safely defaults absent or forward-version ids', () => {
		expect(weaponById(DEFAULT_WEAPON)).toBe(WEAPONS[DEFAULT_WEAPON]);
		expect(weaponById(undefined)).toBe(WEAPONS[DEFAULT_WEAPON]);
		expect(weaponById(999)).toBe(WEAPONS[DEFAULT_WEAPON]);
		expect(weaponById(-1)).toBe(WEAPONS[DEFAULT_WEAPON]);
	});
});
