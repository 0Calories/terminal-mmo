// Entity sprite registry + lookup facade. Non-entity categories (terrain,
// buildings, items) will get their own registries; they reuse the same `Sprite`
// machinery but key off their own types, so there's no single mega-registry.
import type { EntityType } from '@mmo/shared';
import { chaser } from './chaser';
import { player } from './player';
import { shooter } from './shooter';
import type { Sprite } from './sprite';

// `Record<EntityType, …>` forces every entity type to have art: adding a new
// EntityType fails the build here until it's given a Sprite.
const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

export { PALETTE } from './palette';
export { Sprite } from './sprite';
