import type { EntityType, Zone } from '@mmo/shared';

/** Display glyph for each entity kind, overlaid on the terrain at its anchor. */
const SPAWN_GLYPH: Partial<Record<EntityType, string>> = {
	chaser: 'c',
	shooter: 's',
	brute: 'b',
};
const NPC_GLYPH = 'N';
const PORTAL_GLYPH = 'P';

const LEGEND: Record<string, string> = {
	'#': 'solid terrain',
	c: 'chaser spawn',
	s: 'shooter spawn',
	b: 'brute spawn',
	N: 'npc',
	P: 'portal',
};

/**
 * Renderer-free ASCII dump of a parsed Zone: the normalized terrain grid with
 * entity glyphs overlaid at their anchor cells, plus a legend of every glyph
 * present. This is what an agent reads to "see" a Zone — no opentui. Pure.
 */
export function renderZone(zone: Zone): string {
	const { w, h, cells } = zone.terrain;
	const grid: string[][] = [];
	for (let y = 0; y < h; y++) {
		const row: string[] = [];
		for (let x = 0; x < w; x++) row.push(cells[y * w + x] === 1 ? '#' : '.');
		grid.push(row);
	}

	const present = new Set<string>(['#']);
	const place = (x: number, y: number, ch: string) => {
		if (y >= 0 && y < h && x >= 0 && x < w) grid[y][x] = ch;
		present.add(ch);
	};
	for (const s of zone.spawns) place(s.x, s.y, SPAWN_GLYPH[s.type] ?? '?');
	for (const n of zone.npcs ?? []) place(n.x, n.y, NPC_GLYPH);
	for (const p of zone.portals) place(p.x, p.y, PORTAL_GLYPH);

	const legend = Object.keys(LEGEND)
		.filter((ch) => present.has(ch))
		.map((ch) => `  ${ch} ${LEGEND[ch]}`)
		.join('\n');

	return [
		`${zone.id}  ${zone.type}  ${w}×${h}`,
		'',
		...grid.map((row) => row.join('')),
		'',
		'legend:',
		legend,
	].join('\n');
}
