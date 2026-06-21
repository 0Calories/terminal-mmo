// world.ts — the shared World of Zones. A Zone is the unit of place + simulation
// (CONTEXT: Zone); the World is every Zone, advanced by a shared tick. This is
// server-authoritative in M2; here it also drives the single-player loop.

import { BOX, GROUND_TOP, MONSTER, SHOOTER, SPAWN, TOWN } from './constants';
import { makeStarterField, makeTownTerrain } from './terrain';
import type {
	Box,
	Entity,
	EntityType,
	Npc,
	PendingRespawn,
	Projectile,
	SpawnPoint,
	Terrain,
} from './types';

export type ZoneId = string;
export type ZoneType = 'field' | 'town';

/** A connection between Zones (CONTEXT: Zone — Zones connect via portals). A
 * trigger box that, on entry, moves the Avatar to `target` at `arrival`. */
export interface Portal extends Box {
	target: ZoneId;
	arrival: { x: number; y: number };
}

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
	portals: Portal[]; // connections to other Zones (story 14)
	// non-combat interactables — the Town vendor for MVP (story 29). Optional so
	// existing Zone literals (e.g. in tests) stay valid; absent == none.
	npcs?: Npc[];
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
	// shooters are frailer + slower than chasers
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
		// a Portal back to the Town hub, near the Field entrance (story 14)
		portals: [
			{
				x: 24,
				y: GROUND_TOP - 7,
				w: 4,
				h: 7,
				target: 'town-01',
				arrival: { x: 12, y: GROUND_TOP - BOX.h },
			},
		],
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
		// a Portal back out to the Field, off to the right of the plaza (story 14)
		portals: [
			{
				x: TOWN.w - 16,
				y: GROUND_TOP - 7,
				w: 4,
				h: 7,
				target: 'field-01',
				arrival: { x: SPAWN.x, y: SPAWN.y },
			},
		],
		// the vendor NPC: stands on the plaza, left of centre, where the Avatar can
		// walk up and sell loot for Gold (story 29).
		npcs: [
			{
				id: 1,
				kind: 'vendor',
				name: 'Merchant',
				x: 32,
				y: GROUND_TOP - BOX.h,
				w: 4,
				h: BOX.h,
			},
		],
	};
}
