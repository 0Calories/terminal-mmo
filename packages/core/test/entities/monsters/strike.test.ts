import { expect, test } from 'bun:test';
import { COMBAT } from '../../../src/combat';
import type { Entity } from '../../../src/entities';
import { MONSTERS, spawnMonster } from '../../../src/entities';
import { meleeKnockback, monsterStrike } from '../../../src/entities/monsters';
import { SPAWN_Y } from '../../helpers';

test('an unscaled knockback reproduces the shared Strike impulse exactly', () => {
	expect(meleeKnockback(1)).toEqual({
		knockback: COMBAT.knockback,
		knockbackUp: COMBAT.knockbackUp,
	});
});

test('a knockback scale multiplies both components of the Strike impulse', () => {
	expect(meleeKnockback(2.5)).toEqual({
		knockback: COMBAT.knockback * 2.5,
		knockbackUp: COMBAT.knockbackUp * 2.5,
	});
});

test('the stock swing leaves the shared impulse untouched for chaser and brute', () => {
	const ctx = { attackTBefore: 1, nextProjectileId: 1 };
	for (const type of ['chaser', 'brute'] as const) {
		const m: Entity = spawnMonster(type, 3, 50, SPAWN_Y);
		m.attackT = COMBAT.swing.recovery + COMBAT.swing.active / 2;
		const strike = MONSTERS[type].combat.project?.(m, ctx)?.strikes?.[0];
		expect(strike?.knockback).toBe(COMBAT.knockback);
		expect(strike?.knockbackUp).toBe(COMBAT.knockbackUp);
	}
});

test('a Strike carries its shape onto the monster that threw it', () => {
	const m: Entity = spawnMonster('chaser', 3, 50, SPAWN_Y);
	m.facing = -1;
	const hitbox = { x: 1, y: 2, w: 3, h: 4 };
	expect(
		monsterStrike(m, hitbox, { damage: 5, poiseDamage: 6, knockback: 2 }),
	).toEqual({
		attackerId: m.id,
		attackerKind: 'monster',
		hitbox,
		damage: 5,
		poiseDamage: 6,
		facing: -1,
		faction: 'monsters',
		attackerX: m.x,
		...meleeKnockback(2),
	});
});
