// A Portal is the one data-carrying Placeable (`{ target, arrival }`), so placing it
// is a small form rather than a one-glyph stamp (#97). This module owns the form's
// pure decisions; the opentui modal that drives them is validated by eye.

import { type Portal, SPAWN } from '@mmo/shared';

/** A grid coordinate pair `[x, y]` as stored in a Portal header entry. */
export type Arrival = [number, number];

/** A Zone the form can target: id plus optional display name (shown in the picker). */
export interface PortalCandidate {
	id: string;
	name?: string;
}

/**
 * The Zones a Portal in `currentId` may target: every authored Zone but the current
 * one (no self-portal), id-sorted. The form only offers these, so a committed Portal
 * can never name a nonexistent Zone.
 */
export function portalCandidates(
	zones: readonly PortalCandidate[],
	currentId: string,
): PortalCandidate[] {
	return zones
		.filter((z) => z.id !== currentId)
		.map((z) =>
			z.name !== undefined ? { id: z.id, name: z.name } : { id: z.id },
		)
		.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Parse the arrival field (`"x,y"`, spaces tolerated) into a tuple, or `undefined`
 * when it isn't two non-negative integers — which keeps the form open (field flagged)
 * rather than committing a malformed Portal.
 */
export function parseArrival(text: string): Arrival | undefined {
	const m = text.trim().match(/^(\d+)\s*,\s*(\d+)$/);
	if (!m) return undefined;
	return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
}

/**
 * Autocomplete `candidates` against `query` (case-insensitive): keep those whose id or
 * name contains it, ranking prefix hits ahead of inner-substring hits (id-sorted within
 * a rank, since {@link portalCandidates} pre-sorted). Empty query keeps the full list.
 */
export function filterCandidates(
	candidates: readonly PortalCandidate[],
	query: string,
): PortalCandidate[] {
	const q = query.trim().toLowerCase();
	if (!q) return candidates.slice();
	const rank = (c: PortalCandidate): number => {
		const id = c.id.toLowerCase();
		const name = c.name?.toLowerCase() ?? '';
		if (id.startsWith(q) || name.startsWith(q)) return 0;
		if (id.includes(q) || name.includes(q)) return 1;
		return 2;
	};
	return candidates
		.map((c, i) => ({ c, i, r: rank(c) }))
		.filter((e) => e.r < 2)
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.map((e) => e.c);
}

/**
 * The arrival point a new Portal into `target` defaults to: the target's RETURN portal
 * cell (the one pointing back at `currentId`), so the traveller lands beside the way
 * home; with no return portal yet, the global {@link SPAWN}. The author can override.
 */
export function defaultArrival(
	target: { portals: readonly Portal[] },
	currentId: string,
): Arrival {
	const back = target.portals.find((p) => p.target === currentId);
	if (back) return [back.x, back.y];
	return [SPAWN.x, SPAWN.y];
}

/** Render an arrival tuple as the canonical `"x,y"` the form field edits. Inverse
 *  of {@link parseArrival} for any valid tuple. */
export function formatArrival(a: Arrival): string {
	return `${a[0]},${a[1]}`;
}
