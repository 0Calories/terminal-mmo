// The client's view-model: what one session renders — its own predicted
// player, the one Zone it can see (rebuilt from snapshots), and this frame's
// CombatEvents. Server-side state never takes this shape; it lives here in
// protocol because it is the client-side projection of the wire snapshots.
import type { CombatEvent } from '../combat/combat';
import type { PlayerClass } from '../combat/skills';
import type { Entity, Item, PlayerProgress } from '../entities/types';
import type { Zone, ZoneId } from '../zones/types';

export interface PlayerState {
	avatar: Entity;
	progress: PlayerProgress;
	inventory: Item[];
	zoneId: ZoneId;
	log: string[];
	nextId: number;
	rngState: number;
	class?: PlayerClass;
	skillCooldowns?: Record<string, number>;
}

export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

export interface GameState {
	player: PlayerState;
	world: World;
	others?: Entity[];
	events?: CombatEvent[];
}

export function activeZone(world: World, zoneId: ZoneId): Zone {
	return world.zones[zoneId];
}
