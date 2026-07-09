import type { EntityType, Npc } from '@mmo/core';
import { brute } from './brute';
import { chaser } from './chaser';
import { merchant } from './merchant';
import { player } from './player';
import { shooter } from './shooter';
import { signpost } from './signpost';
import type { Sprite } from './sprite';

const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
	brute,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

const NPC_REGISTRY: Record<Npc['kind'], Sprite> = {
	vendor: merchant,
	signpost,
};

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return NPC_REGISTRY[kind];
}
