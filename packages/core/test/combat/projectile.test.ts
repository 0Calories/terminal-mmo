import { expect, test } from 'bun:test';
import { spawnProjectile } from '../../src/combat';
import type { Entity } from '../../src/entities';

test('spawnProjectile launches ahead of the shooter in its facing direction', () => {
	const shooter: Entity = {
		id: 2,
		type: 'shooter',
		x: 10,
		y: 4,
		vx: 0,
		vy: 0,
		speed: 9,
		facing: -1,
		onGround: true,
		hp: 16,
		maxHp: 16,
		hurtT: 0,
		attackT: 0,
	};
	const right = spawnProjectile(7, shooter, 1);
	const left = spawnProjectile(8, shooter, -1);
	expect(right.vx).toBeGreaterThan(0);
	expect(right.x).toBeGreaterThan(shooter.x);
	expect(left.vx).toBeLessThan(0);
	expect(left.x).toBeLessThan(shooter.x);
});

test('a spawned shot carries the full hit-reaction payload as a hostile shot', () => {
	const shooter: Entity = {
		id: 2,
		type: 'shooter',
		x: 10,
		y: 4,
		vx: 0,
		vy: 0,
		speed: 9,
		facing: 1,
		onGround: true,
		hp: 16,
		maxHp: 16,
		hurtT: 0,
		attackT: 0,
	};
	const p = spawnProjectile(7, shooter, 1);
	expect(p.poiseDamage).toBeGreaterThan(0);
	expect(p.knockback).toBeGreaterThan(0);
	expect(p.knockbackUp).toBeGreaterThan(0);
});
