import { BOX, COMBAT } from './constants';
import type { Box, Entity } from './types';

/** The logical collision/hit box of an entity (decoupled from its sprite). */
export function entityBox(e: Entity): Box {
	return { x: e.x, y: e.y, w: BOX.w, h: BOX.h };
}

/** Forgiving frontal melee arc: a wide box extending in the facing direction,
 * full body height (CONTEXT: Combat — melee is forgiving). */
export function meleeHitbox(p: Entity): Box {
	const w = COMBAT.meleeReach;
	return {
		x: p.facing === 1 ? p.x + BOX.w : p.x - w,
		y: p.y,
		w,
		h: BOX.h,
	};
}

export function aabbOverlap(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}
