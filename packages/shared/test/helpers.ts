import { GROUND_TOP, SHOOTER, WORLD } from '../src/constants';
import { parseTerrain } from '../src/terrain';
import type { Projectile, Terrain } from '../src/types';

/**
 * A test Projectile with the default SHOOTER pebble payload (ADR 0017 §8), so fixtures
 * needn't re-list the full hit-reaction payload.
 */
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

/**
 * A flat field: solid floor from GROUND_TOP down, open sky above — the minimal
 * deterministic terrain the combat/physics seam tests need to stand entities on.
 */
export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}
