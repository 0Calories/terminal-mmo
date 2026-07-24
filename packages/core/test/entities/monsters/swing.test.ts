import { expect, test } from 'bun:test';
import { meleeHitbox, SWING_TOTAL } from '../../../src/combat/combat';
import { COMBAT } from '../../../src/combat/constants';
import type { Entity } from '../../../src/entities';
import { MONSTERS, spawnMonster } from '../../../src/entities';
import {
	meleeKnockback,
	SWING_DEFAULTS,
	swingEngine,
} from '../../../src/entities/monsters';
import { SPAWN_Y } from '../../helpers';

const STATS = MONSTERS.chaser.stats;
const SHAPE = SWING_DEFAULTS;
const swing = swingEngine()(STATS);

const ACTIVE_T = COMBAT.swing.active / 2 + COMBAT.swing.recovery;

function chaser(attackT = 0): Entity {
	const m = spawnMonster('chaser', 3, 50, SPAWN_Y);
	m.onGround = true;
	m.facing = -1;
	m.attackT = attackT;
	return m;
}

test('a swing owns no body: the Brain drive stands as it is', () => {
	expect(swing.committedDrive?.(chaser(SWING_TOTAL)) ?? null).toBeNull();
});

test('the commit sets the swing timer, the cooldown and a fresh hit list', () => {
	const m = chaser();
	m.swingHits = [9];
	const after = swing.commit?.(m);
	expect(after?.attackT).toBe(SWING_TOTAL);
	expect(after?.attackCdT).toBe(SHAPE.cooldown);
	expect(after?.swingHits).toEqual([]);
});

test('the finished step leaves a swing timer alone', () => {
	const m = chaser(ACTIVE_T);
	expect(swing.afterStep?.(m).attackT ?? m.attackT).toBe(ACTIVE_T);
});

test('the active window projects the reach hitbox', () => {
	const m = chaser(ACTIVE_T);
	const projection = swing.project?.(m, {
		attackTBefore: SWING_TOTAL,
		nextProjectileId: 1,
	});
	expect(projection?.shots ?? []).toEqual([]);
	expect(projection?.strikes).toEqual([
		{
			attackerId: m.id,
			attackerKind: 'monster',
			hitbox: meleeHitbox(m),
			damage: STATS.damage,
			poiseDamage: SHAPE.poiseDamage,
			facing: -1,
			faction: 'monsters',
			attackerX: m.x,
			...meleeKnockback(SHAPE.knockback),
		},
	]);
});

test('wind-up, recovery and rest project nothing', () => {
	const ctx = { attackTBefore: SWING_TOTAL, nextProjectileId: 1 };
	for (const attackT of [SWING_TOTAL, COMBAT.swing.recovery / 2, 0])
		expect(swing.project?.(chaser(attackT), ctx)?.strikes ?? []).toEqual([]);
});
