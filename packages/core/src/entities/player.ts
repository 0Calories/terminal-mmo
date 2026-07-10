import type { PlayerClass } from '../combat/skills';
import type { ZoneId } from '../world/world';
import { spawnAvatar } from './factory';
import type { Entity, Item, PlayerProgress } from './types';

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
		log: ['Welcome. Hunt the chasers (j attack, k guard).'],
		nextId: 1,
		rngState: seed,
		class: 'warrior',
		skillCooldowns: {},
	};
}
