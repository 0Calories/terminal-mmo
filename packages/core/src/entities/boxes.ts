import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '../sprites/meta';
import { BOX } from './body';
import type { Npc } from './npc';
import type { EntityType, MonsterType } from './types';

export interface BoxDims {
	readonly w: number;
	readonly h: number;
}

/** The authored NPC slot in a Zone grid; a derived box replaces it per kind. */
export const NPC_BOX: BoxDims = { w: 4, h: BOX.h };

const monsterBoxes = new Map<MonsterType, BoxDims>();
const npcBoxes = new Map<Npc['kind'], BoxDims>();

/** Derived logical boxes keyed by sprite id, one map per sprite role. */
export interface SpriteBoxCatalog {
	monsters?: ReadonlyMap<string, BoxDims>;
	npcs?: ReadonlyMap<string, BoxDims>;
}

function valid(box: BoxDims | undefined): box is BoxDims {
	return box !== undefined && box.w > 0 && box.h > 0;
}

/**
 * Register the sprite-derived logical boxes for server-controlled catalog
 * entities. Keys are matched through the monster/NPC sprite references, so
 * an Avatar's canonical {@link BOX} can never be overridden. Idempotent;
 * call at asset load.
 */
export function registerSpriteBoxes(catalog: SpriteBoxCatalog): void {
	for (const [type, ref] of Object.entries(MONSTER_SPRITE_REF)) {
		const box = catalog.monsters?.get(ref);
		if (valid(box))
			monsterBoxes.set(type as MonsterType, { w: box.w, h: box.h });
	}
	for (const [kind, ref] of Object.entries(NPC_SPRITE_REF)) {
		const box = catalog.npcs?.get(ref);
		if (valid(box)) npcBoxes.set(kind as Npc['kind'], { w: box.w, h: box.h });
	}
}

/** Drop every registered derived box (test isolation hook). */
export function clearSpriteBoxes(): void {
	monsterBoxes.clear();
	npcBoxes.clear();
}

/** The logical box an entity of this type occupies: the Avatar's canonical
 *  {@link BOX}, or the monster's sprite-derived box once registered. */
export function boxOf(type: EntityType | undefined): BoxDims {
	if (type === undefined || type === 'player') return BOX;
	return monsterBoxes.get(type) ?? BOX;
}

/** The logical box an NPC of this kind occupies; {@link NPC_BOX} until a
 *  derived box registers. */
export function npcBoxOf(kind: Npc['kind']): BoxDims {
	return npcBoxes.get(kind) ?? NPC_BOX;
}
