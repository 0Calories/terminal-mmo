import { GROUND_TOP, SHOOTER, WORLD } from '../src/constants';
import { parseTerrain } from '../src/terrain';
import type { Projectile, Terrain } from '../src/types';

export function makeProjectile(over: Partial<Projectile> = {}): Projectile {
	return {
		id: 1,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		life: 2,
		damage: SHOOTER.projDamage,
		poiseDamage: SHOOTER.projPoise,
		knockback: SHOOTER.projKnockback,
		knockbackUp: SHOOTER.projKnockbackUp,
		...over,
	};
}

export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}
