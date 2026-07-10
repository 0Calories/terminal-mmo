// Tests exercise the sim against the real authored content, so they load it
// through @mmo/assets (dev-only dependency); core's own source stays
// content-free — "given content, simulate" (ADR 0033).
import { loadZones } from '@mmo/assets';
import { ARCHETYPES } from '../src/entities/archetypes';
import type { Projectile, Terrain } from '../src/entities/types';
import { parseTerrain } from '../src/physics/terrain';
import { GROUND_TOP, WORLD } from '../src/world/constants';
import { createGameFromZones, type GameState } from '../src/world/sim';

// The shipped game booted for tests: what core's createGame() was before core
// dropped bundled zone content. loadZones() returns the start Town first.
export function createGame(seed = 1): GameState {
	const zones = loadZones();
	return createGameFromZones(zones, zones[0].id, seed);
}

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
