import type { EntityType, Npc } from '../types';

// Sprite *metadata* — the identity crumb the deterministic sim reads, never the art.
// The default palette key feeds `entityTint` (a monster with no cosmetics takes its
// body colour), which authoritative combat resolves for the death tint; the art grids
// keyed by these live in @mmo/render.

export interface SpriteMeta {
	// The default palette key the entity's body paints with (feeds entityTint).
	defaultKey: string;
	// Rows the sprite sits above the logical box's feet (art-authored, sim-agnostic).
	baseline: number;
}

const ENTITY_SPRITE_META: Record<EntityType, SpriteMeta> = {
	player: { defaultKey: 'p', baseline: 0 },
	chaser: { defaultKey: 'm', baseline: 0 },
	shooter: { defaultKey: 'o', baseline: 0 },
	brute: { defaultKey: 's', baseline: 0 },
};

export function spriteMetaFor(type: EntityType): SpriteMeta {
	return ENTITY_SPRITE_META[type];
}

// Art references (ADR 0031): the sprite-id each Monster type / NPC kind resolves
// its art through — the WEAPONS-catalog `sprite` field pattern applied to entities.
// Core owns only the reference id (a crumb), never the art: the id keys the
// `.sprite` files under `sprites/monsters/` and `sprites/npcs/`, compiled into
// runtime Sprites in @mmo/render. This is the seam that replaces the old TS
// `import { chaser } from './chaser'` art graph. `player` has no Monster art — it
// renders through the Form registry — so it is absent here by construction.
export const MONSTER_SPRITE_REF: Readonly<
	Record<Exclude<EntityType, 'player'>, string>
> = {
	chaser: 'chaser',
	shooter: 'shooter',
	brute: 'brute',
};

export const NPC_SPRITE_REF: Readonly<Record<Npc['kind'], string>> = {
	vendor: 'merchant',
};

// Resolve a Monster entity type to its art-reference sprite id (undefined for the
// player, which is not Monster art). Observers key the @mmo/render monster sprite
// registry with this id.
export function monsterSpriteRef(type: EntityType): string | undefined {
	return type === 'player' ? undefined : MONSTER_SPRITE_REF[type];
}

// Resolve an NPC kind to its art-reference sprite id.
export function npcSpriteRef(kind: Npc['kind']): string {
	return NPC_SPRITE_REF[kind];
}
