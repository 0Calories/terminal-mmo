import { expect, test } from 'bun:test';
import { parseTerrain, stepProjectile } from '../../src/physics';
import { makeProjectile } from '../helpers';

test('a projectile travels in its velocity direction over a step', () => {
	const open = parseTerrain(['      ', '      ', '      ']);
	const p = makeProjectile({ x: 1, y: 1, vx: 10, damage: 5 });
	const next = stepProjectile(open, p, 0.1);
	expect(next).not.toBeNull();
	expect(next?.x).toBeCloseTo(2);
	expect(next?.y).toBeCloseTo(1);
});

test('a projectile despawns when it enters solid Terrain', () => {
	const walled = parseTerrain(['   #  ', '   #  ', '   #  ']);
	const p = makeProjectile({ x: 1, y: 1, vx: 25, damage: 5 });
	expect(stepProjectile(walled, p, 0.1)).toBeNull();
});

test('a projectile despawns when its lifetime runs out', () => {
	const open = parseTerrain(['      ', '      ', '      ']);
	const p = makeProjectile({ x: 1, y: 1, life: 0.05, damage: 5 });
	expect(stepProjectile(open, p, 0.1)).toBeNull();
});

test('a fast projectile cannot tunnel through a thin wall (swept, not point-checked)', () => {
	const walled = parseTerrain(['   #  ', '   #  ', '   #  ']);

	const p = makeProjectile({ x: 1, y: 1, vx: 50, damage: 5 });
	expect(stepProjectile(walled, p, 0.1)).toBeNull();
});

test('a shot flies through a one-way platform sideways (the global one-way rule)', () => {
	const platform = parseTerrain(['      ', ' ==== ', '      ']);
	const p = makeProjectile({ x: 0.5, y: 1.5, vx: 25, damage: 5 });
	const next = stepProjectile(platform, p, 0.1);
	expect(next).not.toBeNull();
	expect(next?.x).toBeCloseTo(3);
});
