import type { Npc } from '../entities/npc';
import type {
	Box,
	Drop,
	Entity,
	PendingRespawn,
	Projectile,
	SpawnPoint,
	Terrain,
} from '../entities/types';

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
