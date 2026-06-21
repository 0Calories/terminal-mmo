import type { EntityType, Npc } from '@mmo/shared';
import { chaser } from './chaser';
import { merchant } from './merchant';
import { player } from './player';
import { shooter } from './shooter';
import type { Sprite } from './sprite';

// `Record<EntityType, …>` forces every entity type to have art at compile time.
const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

// NPCs aren't entities (not simulated), so they key off their own `kind`.
const NPC_REGISTRY: Record<Npc['kind'], Sprite> = {
	vendor: merchant,
};

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return NPC_REGISTRY[kind];
}

export { PALETTE } from './palette';
export { Sprite } from './sprite';
