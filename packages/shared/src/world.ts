import { DEFAULT_MASS, MONSTER, SHOOTER, TANK } from './constants';
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

export function spawnMonster(
	type: EntityType,
	id: number,
	x: number,
	y: number,
	spawnIndex?: number,
): Entity {
	const hp =
		type === 'shooter'
			? SHOOTER.hp
			: type === 'tank'
				? TANK.hp
				: MONSTER.chaserHp;
	const speed =
		type === 'shooter'
			? SHOOTER.speed
			: type === 'tank'
				? TANK.speed
				: MONSTER.chaserSpeed;
	const e: Entity = {
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
		mass: DEFAULT_MASS,
		spawnIndex,
	};
	// The poise-tank (ADR 0017 §6): a heavy body with a LARGE Poise pool, so a single
	// Launcher can't break it — it must be chipped down first (the launch-gating). Its
	// pool seeds full so the first hits are pure chip.
	if (type === 'tank') {
		e.mass = TANK.mass;
		e.poiseMax = TANK.poiseMax;
		e.poise = TANK.poiseMax;
	}
	return e;
}
