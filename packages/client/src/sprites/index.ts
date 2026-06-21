// Entity sprite registry + lookup facade. Non-entity categories (terrain,
// buildings, items) get their own registries keyed off their own types — no
// single mega-registry — while reusing the same `Sprite` machinery.
import type { EntityType, Npc } from '@mmo/shared';
import { chaser } from './chaser';
import { merchant } from './merchant';
import { player } from './player';
import { shooter } from './shooter';
import type { Sprite } from './sprite';

// `Record<EntityType, …>` forces every entity type to have art: a new
// EntityType fails the build here until given a Sprite.
const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

// NPCs aren't entities (non-combat Town interactables, not simulated), so they
// key off their own `kind` in a separate registry. `Record<Npc['kind'], …>`
// forces every NPC kind to have art.
const NPC_REGISTRY: Record<Npc['kind'], Sprite> = {
	vendor: merchant,
};

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return NPC_REGISTRY[kind];
}

export { PALETTE } from './palette';
export { Sprite } from './sprite';
