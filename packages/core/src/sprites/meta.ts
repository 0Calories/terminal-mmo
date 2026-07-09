import type { EntityType } from '../types';

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

// Registry index — how many cosmetic Forms exist, the metadata cosmetics
// validation clamps against. The art registry in @mmo/render must match this
// count (guarded by a render-side test).
export const DEFAULT_FORM = 0;
export const FORM_COUNT = 1;
