import { BRUTE, DEFAULT_MASS, MONSTER, SHOOTER } from './constants';
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
	/** Optional human display label, distinct from `id` — decorative, never used to
	 *  resolve a Zone (cf. Zone id vs Zone name in CONTEXT.md). */
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
}

export interface World {
	zones: Record<ZoneId, Zone>;
	tick: number;
}

export function activeZone(world: World, zoneId: ZoneId): Zone {
	return world.zones[zoneId];
}

// The per-archetype spawn stats (HP / speed / Mass / Poise ceiling), in one lookup so
// each Monster type is defined in a single place rather than scattered across parallel
// ternaries. `poiseMax` absent inherits the shared COMBAT.poise.max; only the heavy
// brute overrides it (its "high-poise" identity) and its Mass (Knockback resistance).
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
