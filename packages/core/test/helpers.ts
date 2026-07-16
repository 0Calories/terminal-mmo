// Shared fixture helpers. Tests that want the real authored content load it
// through @mmo/assets (dev-only dependency); core's own source stays
// content-free — "given content, simulate" (ADR 0033).
import { ARCHETYPES } from '../src/entities/archetypes';
import type { Projectile, Terrain } from '../src/entities/types';
import { parseTerrain } from '../src/physics/terrain';
import { GROUND_TOP, WORLD } from '../src/zones/constants';

export function makeProjectile(over: Partial<Projectile> = {}): Projectile {
	return {
		id: 1,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		life: 2,
		damage: ARCHETYPES.shooter.ranged.projectile.damage,
		poiseDamage: ARCHETYPES.shooter.ranged.projectile.poise,
		knockback: ARCHETYPES.shooter.ranged.projectile.knockback,
		knockbackUp: ARCHETYPES.shooter.ranged.projectile.knockbackUp,
		...over,
	};
}

export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}
