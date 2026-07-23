import { ARCHETYPES, BOX } from '../src/entities/archetypes';
import { DEFAULT_COSMETICS } from '../src/entities/cosmetics';
import { spawnAvatar } from '../src/entities/factory';
import type { Entity, Projectile, Terrain } from '../src/entities/types';
import { parseTerrain } from '../src/physics/terrain';
import { GROUND_TOP, WORLD } from '../src/zones/constants';
import type { Zone } from '../src/zones/types';
import type { AvatarIntent, ServerAvatar } from '../src/zones/zone';

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

export function islandTerrain(w = 60, groundEnd = 30): Terrain {
	const rows: string[] = [];
	for (let cy = 0; cy < GROUND_TOP; cy++) rows.push('.'.repeat(w));
	for (let cy = GROUND_TOP; cy < GROUND_TOP + 3; cy++)
		rows.push('#'.repeat(groundEnd + 1) + '.'.repeat(w - groundEnd - 1));
	return parseTerrain(rows);
}

export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}

export const SPAWN_Y = GROUND_TOP - BOX.h;

export function serverAvatar(
	sessionId: number,
	x: number,
	handle = 'hero',
	level = 1,
): ServerAvatar {
	return {
		sessionId,
		handle,
		cosmetics: DEFAULT_COSMETICS,
		avatar: { ...spawnAvatar(x, SPAWN_Y), id: sessionId },
		progress: { level, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
	};
}

export function zoneWith(monsters: Entity[], id = 'test-zone'): Zone {
	return {
		id,
		type: 'field',
		terrain: flatTerrain(),
		monsters,
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 100,
	};
}

export function holdAt(sessionId: number, e: Entity): AvatarIntent {
	return {
		sessionId,
		x: e.x,
		y: e.y,
		vx: 0,
		vy: 0,
		facing: e.facing,
		onGround: e.onGround,
		attack: false,
	};
}
