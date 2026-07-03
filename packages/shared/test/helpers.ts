import { GROUND_TOP, SHOOTER, WORLD } from '../src/constants';
import { parseTerrain } from '../src/terrain';
import type { Projectile, Terrain } from '../src/types';

/**
 * A test Projectile carrying the default SHOOTER pebble payload, overridable per
 * field (ADR 0017 §8). Keeps the many projectile fixtures from re-listing the full
 * hit-reaction payload.
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
 * A flat field: a full solid floor from GROUND_TOP down, open sky above. The
 * factory `makeStarterField` (with its seeded platforms) is gone (ADR 0008); the
 * combat/physics seam tests only ever needed *some* ground at GROUND_TOP, so this
 * is the minimal deterministic terrain to stand Avatars and Monsters on.
 */
export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}
