import { DEFAULT_FORM_ID, type EntityType, type Npc } from '@mmo/core';
import { formFrame } from './body-sprite';
import { brute } from './brute';
import { chaser } from './chaser';
import { formById } from './forms';
import { merchant } from './merchant';
import { shooter } from './shooter';
import { signpost } from './signpost';
import type { Sprite } from './sprite';

// A player entity never renders through this registry — drawEntitySprite routes
// players through the Form registry (formById) instead. The `player` entry
// exists only so the EntityType map is total and metadata/golden tests can name
// it; it resolves to the default Form's idle Pose, the same body a real player
// draws, so the two can never drift.
const REGISTRY: Record<EntityType, Sprite> = {
	player: formFrame(formById(DEFAULT_FORM_ID), 'idle'),
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
