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
// Town and Field run one shared instance each; a `dungeon` is instanced — a private
// per-player/per-party ZoneState spun up on entry, torn down on exit (#240, ADR 0024).
export type ZoneType = 'field' | 'town' | 'dungeon';

/** A trigger box that, on entry, moves the Avatar to `target` at `arrival`. */
export interface Portal extends Box {
	target: ZoneId;
	arrival: { x: number; y: number };
}

export interface Zone {
	id: ZoneId;
	/** Human display label, distinct from `id` — decorative, never used to resolve a Zone. */
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
	// Instanced loot Drops resting here (#238): private per owner. Optional (absent == none)
	// so static Zones and fixtures need no empty list; `stepZone` reads it through `?? []`.
	drops?: Drop[];
	// Id source for this Zone's Drops (absent == start at 1), advanced as kills spawn them.
	nextDropId?: number;
}

export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

export function activeZone(world: World, zoneId: ZoneId): Zone {
	return world.zones[zoneId];
}

// Per-archetype spawn stats. `poiseMax` absent inherits the shared COMBAT.poise.max;
// only the brute overrides it and its Mass.
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
		default: // chaser
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
		// Absent for every Monster but the brute — the rest inherit COMBAT.poise.max.
		...(poiseMax !== undefined ? { poiseMax } : {}),
		spawnIndex,
	};
}
