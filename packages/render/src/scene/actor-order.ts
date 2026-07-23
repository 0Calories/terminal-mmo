/**
 * Deterministic pass-3 crowd ordering (ADR 0038). NPCs, Monsters, and remote
 * Avatars share one back-to-front list keyed by logical foot depth; equal depth
 * resolves by actor category — keeping NPCs behind monsters and avatars — and
 * then a stable id, so equal-depth actors never flicker frame to frame. This is
 * pure ordering: foot-depth values are computed by the sprite painters and the
 * category and id are assigned by the caller.
 */

export type ActorCategory = 'npc' | 'monster' | 'avatar';

/**
 * Draw rank at equal foot depth. NPCs stay behind the entity crowd (the prior
 * NPC-behind-entity behaviour); monsters stay behind remote avatars, matching
 * the previous concat order.
 */
export const ACTOR_CATEGORY_RANK: Record<ActorCategory, number> = {
	npc: 0,
	monster: 1,
	avatar: 2,
};

export interface DepthKey {
	/** World-y of the actor's collision-box bottom; larger draws later, nearer the
	 *  front. Baseline is foot-art idiom, not depth, so it never enters this key. */
	readonly footY: number;
	readonly category: ActorCategory;
	/** Stable per-actor id; final tie-break so equal-depth actors keep a fixed order. */
	readonly id: number;
}

/** Back-to-front order: foot depth, then category rank, then stable id. */
export function compareActorDepth(a: DepthKey, b: DepthKey): number {
	if (a.footY !== b.footY) return a.footY - b.footY;
	const rank =
		ACTOR_CATEGORY_RANK[a.category] - ACTOR_CATEGORY_RANK[b.category];
	if (rank !== 0) return rank;
	return a.id - b.id;
}

/** A stable, input-order-independent back-to-front sort of the crowd. */
export function sortActorsByDepth<T extends DepthKey>(
	items: readonly T[],
): T[] {
	return [...items].sort(compareActorDepth);
}
