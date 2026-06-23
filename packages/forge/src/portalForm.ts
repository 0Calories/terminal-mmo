// The Portal config form's pure core (#97, epic #91, ADR 0010). A Portal is the
// one data-carrying Placeable — it carries `{ target, arrival }` — so placing it
// is a small form, not a one-glyph stamp. This module owns the form's pure
// decisions (which Zones can be targeted, how the target list autocompletes, the
// default arrival point, and parsing the arrival field); the editor's modal that
// drives them is opentui shell, validated by eye per the PRD.
//
// Pure: no FS, no opentui. The editor loads the Zone set (io.ts) and feeds it in.

import { type Portal, SPAWN } from '@mmo/shared';

/** A grid coordinate pair `[x, y]` as stored in a Portal header entry. */
export type Arrival = [number, number];

/** A Zone the form can target: its id (used to resolve the Portal) plus the
 *  optional display name (shown in the picker so the author reads a label). */
export interface PortalCandidate {
	id: string;
	name?: string;
}

/**
 * The Zones a Portal in `currentId` may target — every authored Zone except the
 * current one (a Zone never portals to itself), id-sorted for a stable list. The
 * form only ever offers these, so a committed Portal can never name a nonexistent
 * Zone (the issue's "can't target a nonexistent zone").
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
 * Parse the arrival field's text (`"x,y"`, spaces tolerated) into a coordinate
 * tuple, or `undefined` when it isn't two non-negative integers. The editor uses
 * `undefined` to keep the form open (and the field flagged) rather than committing
 * a malformed Portal.
 */
export function parseArrival(text: string): Arrival | undefined {
	const m = text.trim().match(/^(\d+)\s*,\s*(\d+)$/);
	if (!m) return undefined;
	return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
}

/**
 * Autocomplete the target list against a typed `query` (case-insensitive): keep
 * the candidates whose id or display name contains it, ranking those that START
 * with the query ahead of inner-substring hits (id-sorted within each rank, since
 * {@link portalCandidates} already sorted them). An empty query keeps the full
 * list. The editor's modal narrows the visible rows as the author types.
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
 * The arrival point a new Portal into `target` defaults to: the cell of the
 * target's RETURN portal (the one already pointing back at `currentId`), so the
 * traveller lands beside the way home. With no return portal yet, fall back to the
 * global avatar {@link SPAWN}. The author can always override the field; this just
 * seeds a sensible, ground-valid default (the issue's "defaulting to the target's
 * return-portal cell (or spawn)").
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
