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

/** A trigger box that, on entry, moves the Avatar to `target` at `arrival`. */
export interface Portal extends Box {
	target: ZoneId;
	arrival: { x: number; y: number };
}

export interface Zone {
	id: ZoneId;
	type: ZoneType;
	terrain: Terrain;
	monsters: Entity[];
	projectiles: Projectile[];
	nextProjectileId: number;
	spawns: SpawnPoint[];
	respawns: PendingRespawn[];
	nextMonsterId: number;
	portals: Portal[];
	npcs?: Npc[];
}

export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

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
