import { type Portal, SPAWN } from '@mmo/core/zones';

export type Arrival = [number, number];

export interface PortalCandidate {
	id: string;
	name?: string;
}

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

export function parseArrival(text: string): Arrival | undefined {
	const m = text.trim().match(/^(\d+)\s*,\s*(\d+)$/);
	if (!m) return undefined;
	return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
}

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

export function defaultArrival(
	target: { portals: readonly Portal[] },
	currentId: string,
): Arrival {
	const back = target.portals.find((p) => p.target === currentId);
	if (back) return [back.x, back.y];
	return [SPAWN.x, SPAWN.y];
}

export function formatArrival(a: Arrival): string {
	return `${a[0]},${a[1]}`;
}
