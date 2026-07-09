import { describe, expect, test } from 'bun:test';
import {
	COMBAT,
	DEFAULT_WEAPON,
	type Entity,
	resolveCombat,
	SWING_TOTAL,
	stepAvatarCombat,
	WEAPONS,
	weaponById,
} from '../src';

function avatar(over: Partial<Entity> = {}): Entity {
	return {
		id: 1,
		type: 'player',
		x: 20,
		y: 4,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		attackT: 0,
		hurtT: 0,
		...over,
	};
}

describe('WEAPONS catalog — name + damage only (ADR 0024/0030)', () => {
	test('a Weapon carries a name and damage and nothing else (art lives in @mmo/render)', () => {
		const allowed = new Set(['name', 'damage']);
		for (const w of WEAPONS)
			for (const key of Object.keys(w)) expect(allowed).toContain(key);
	});

	test('the default weapon (index 0) deals the shared COMBAT melee damage', () => {
		expect(WEAPONS[DEFAULT_WEAPON].damage).toBe(COMBAT.meleeDamage);
	});
});

describe('one shared moveset — no weapon reshapes combat resolution', () => {
	test('a fresh swing loads the ONE shared phase total for every catalog weapon', () => {
		for (let i = 0; i < WEAPONS.length; i++) {
			const r = resolveCombat(
				avatar(),
				{},
				1,
				'warrior',
				{ attack: true },
				0.016,
				weaponById(i),
			);
			expect(r.attackT).toBe(SWING_TOTAL);
		}
	});

	test('the active hitbox spans the shared melee reach, not a per-weapon arc', () => {
		const inActive =
			SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
		for (let i = 0; i < WEAPONS.length; i++) {
			const r = resolveCombat(
				avatar({ attackT: inActive }),
				{},
				1,
				'warrior',
				{},
				0,
				weaponById(i),
			);
			expect(r.hitbox?.w).toBe(COMBAT.meleeReach);
		}
	});

	test('a landed swing deals the weapon damage but the shared poise damage', () => {
		const inActive =
			SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
		const { strikes } = stepAvatarCombat(
			avatar({ attackT: inActive }),
			{},
			{ level: 1, cls: 'warrior', weapon: weaponById(DEFAULT_WEAPON), dt: 0 },
		);
		expect(strikes[0].damage).toBe(weaponById(DEFAULT_WEAPON).damage);
		expect(strikes[0].poiseDamage).toBe(COMBAT.poiseDamage);
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
