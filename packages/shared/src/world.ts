// world.ts — the shared World of Zones. A Zone is the unit of place + simulation
// (CONTEXT: Zone); the World is every Zone, advanced by a shared tick. This is
// server-authoritative in M2; here it also drives the single-player loop.

import { BOX, GROUND_TOP, MONSTER, SHOOTER } from './constants';
import { makeStarterField, makeTownTerrain } from './terrain';
import type {
	Entity,
	EntityType,
	PendingRespawn,
	Projectile,
	SpawnPoint,
	Terrain,
} from './types';

export type ZoneId = string;
export type ZoneType = 'field' | 'town';

/** A discrete, bounded area of the World: solid Terrain + the Monsters in it.
 * Two kinds (CONTEXT: Zone) — combat Fields and safe Towns. */
export interface Zone {
	id: ZoneId;
	type: ZoneType;
	terrain: Terrain;
	monsters: Entity[];
	projectiles: Projectile[];
	nextProjectileId: number; // id source for Projectiles (cf. PlayerState.nextId)
	spawns: SpawnPoint[]; // fixed Monster spawn points (story 20)
	respawns: PendingRespawn[]; // dead Monsters awaiting their respawn timer
	nextMonsterId: number; // id source for respawned Monsters
}

/** The whole World: every Zone keyed by id, plus a shared sim tick. */
export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

/** The Zone a given id refers to. */
export function activeZone(world: World, zoneId: ZoneId): Zone {
	return world.zones[zoneId];
}

export function spawnMonster(
	type: EntityType,
	id: number,
	x: number,
	y: number,
	spawnIndex?: number,
): Entity {
	// per-archetype base stats; shooters are frailer + slower than chasers
	const hp = type === 'shooter' ? SHOOTER.hp : MONSTER.chaserHp;
	const speed = type === 'shooter' ? SHOOTER.speed : MONSTER.chaserSpeed;
	return {
		id,
		type,
		x,
		y,
		vx: 0,
		vy: 0,
		speed,
		facing: 1,
		onGround: false,
		hp,
		maxHp: hp,
		hurtT: 0,
		attackT: 0,
		spawnIndex,
	};
}

/** A combat Field: full-width ground + platforms, with scattered Monsters — a
 * mix of melee chasers and ranged shooters so positioning matters (story 19). */
export function makeFieldZone(id: ZoneId, seed = 1337): Zone {
	const terrain = makeStarterField(seed);
	const spawns: SpawnPoint[] = [];
	for (let i = 0; i < 8; i++) {
		const x = 40 + i * 22;
		const type: EntityType = i % 3 === 2 ? 'shooter' : 'chaser';
		spawns.push({ type, x, y: GROUND_TOP - BOX.h });
	}
	let mid = 2; // the Avatar is id 1
	const monsters = spawns.map((s, i) =>
		spawnMonster(s.type, mid++, s.x, s.y, i),
	);
	return {
		id,
		type: 'field',
		terrain,
		monsters,
		projectiles: [],
		nextProjectileId: 1,
		spawns,
		respawns: [],
		nextMonsterId: mid,
	};
}

/** The Town: a safe social hub (CONTEXT: Town). No Monsters, no spawn points —
 * so no combat can ever occur here — just hand-authored, walkable Terrain. */
export function makeTownZone(id: ZoneId): Zone {
	return {
		id,
		type: 'town',
		terrain: makeTownTerrain(),
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		nextMonsterId: 1,
	};
}
