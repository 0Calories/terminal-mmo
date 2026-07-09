import { BRUTE, DEFAULT_MASS, MONSTER, SHOOTER } from './constants';
import type {
	Box,
	Drop,
	Entity,
	EntityType,
	Npc,
	PendingRespawn,
	Projectile,
	SpawnPoint,
	Terrain,
} from './types';

export type ZoneId = string;
export type ZoneType = 'field' | 'town' | 'dungeon';

export interface Portal extends Box {
	target: ZoneId;
	arrival: { x: number; y: number };
}

export interface Zone {
	id: ZoneId;
	name?: string;
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
	drops?: Drop[];
	nextDropId?: number;
}

export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

export function activeZone(world: World, zoneId: ZoneId): Zone {
	return world.zones[zoneId];
}

interface SpawnStats {
	hp: number;
	speed: number;
	mass: number;
	poiseMax?: number;
}

function spawnStats(type: EntityType): SpawnStats {
	switch (type) {
		case 'shooter':
			return { hp: SHOOTER.hp, speed: SHOOTER.speed, mass: DEFAULT_MASS };
		case 'brute':
			return {
				hp: BRUTE.hp,
				speed: BRUTE.speed,
				mass: BRUTE.mass,
				poiseMax: BRUTE.poiseMax,
			};
		default:
			return {
				hp: MONSTER.chaserHp,
				speed: MONSTER.chaserSpeed,
				mass: DEFAULT_MASS,
			};
	}
}

export function spawnMonster(
	type: EntityType,
	id: number,
	x: number,
	y: number,
	spawnIndex?: number,
): Entity {
	const { hp, speed, mass, poiseMax } = spawnStats(type);
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
		mass,
		...(poiseMax !== undefined ? { poiseMax } : {}),
		spawnIndex,
	};
}
