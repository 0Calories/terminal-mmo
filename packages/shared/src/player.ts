import { PHYS } from './constants';
import { maxHpForLevel } from './progression';
import type { PlayerClass } from './skills';
import type { Entity, Item, PlayerProgress } from './types';
import type { ZoneId } from './world';

export interface PlayerState {
	avatar: Entity;
	progress: PlayerProgress;
	inventory: Item[];
	zoneId: ZoneId;
	log: string[];
	nextId: number; // id source for looted Items
	rngState: number;
	class?: PlayerClass; // sim treats absent as 'warrior'
	skillCooldowns?: Record<string, number>; // seconds per Skill id; absent/0 == ready
}

// the Avatar is always entity id 1
export function spawnAvatar(x: number, y: number): Entity {
	return {
		id: 1,
		type: 'player',
		x,
		y,
		vx: 0,
		vy: 0,
		speed: PHYS.speed,
		facing: 1,
		onGround: false,
		hp: maxHpForLevel(1),
		maxHp: maxHpForLevel(1),
		hurtT: 0,
		attackT: 0,
	};
}

export function spawnPlayerState(
	zoneId: ZoneId,
	x: number,
	y: number,
	seed = 1,
): PlayerState {
	return {
		avatar: spawnAvatar(x, y),
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		zoneId,
		log: ['Welcome. Hunt the chasers (j to attack).'],
		nextId: 1,
		rngState: seed,
		class: 'warrior',
		skillCooldowns: {},
	};
}
