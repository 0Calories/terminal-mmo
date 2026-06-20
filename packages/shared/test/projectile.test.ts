import { expect, test } from 'bun:test';
import type { Entity, Projectile } from '../src';
import { parseTerrain, spawnProjectile, stepProjectile } from '../src';

test('a projectile travels in its velocity direction over a step', () => {
	const open = parseTerrain(['      ', '      ', '      ']);
	const p: Projectile = {
		id: 1,
		x: 1,
		y: 1,
		vx: 10,
		vy: 0,
		life: 2,
		damage: 5,
		ownerId: 2,
	};
	const next = stepProjectile(open, p, 0.1);
	expect(next).not.toBeNull();
	expect(next?.x).toBeCloseTo(2);
	expect(next?.y).toBeCloseTo(1);
});

test('a projectile despawns when it enters solid Terrain', () => {
	// a wall at column 3; the projectile crosses into it this step
	const walled = parseTerrain(['   #  ', '   #  ', '   #  ']);
	const p: Projectile = {
		id: 1,
		x: 1,
		y: 1,
		vx: 25,
		vy: 0,
		life: 2,
		damage: 5,
		ownerId: 2,
	};
	expect(stepProjectile(walled, p, 0.1)).toBeNull(); // x → 3.5, column 3 is solid
});

test('a projectile despawns when its lifetime runs out', () => {
	const open = parseTerrain(['      ', '      ', '      ']);
	const p: Projectile = {
		id: 1,
		x: 1,
		y: 1,
		vx: 0,
		vy: 0,
		life: 0.05,
		damage: 5,
		ownerId: 2,
	};
	expect(stepProjectile(open, p, 0.1)).toBeNull();
});

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
	expect(right.ownerId).toBe(shooter.id);
});
