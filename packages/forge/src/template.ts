import type { ZoneType } from '@mmo/shared';

/** Sane default canvas for a fresh Zone — wide enough to scroll, with a floor. */
const SIZE: Record<ZoneType, { w: number; h: number }> = {
	field: { w: 60, h: 16 },
	town: { w: 40, h: 16 },
	dungeon: { w: 60, h: 16 },
};

/**
 * Emit a blank-grid `.zone` template: valid header, `.`-filled grid, solid floor row.
 * A `town` template validates clean; a combat template (`field`/`dungeon`) has one
 * error — the missing spawn, the expected next edit.
 */
export function newZoneTemplate(id: string, type: ZoneType): string {
	const { w, h } = SIZE[type];
	// The id is the filename (ADR 0011), never a header field, so the template emits no
	// `id`. `name` is the decorative display label (#99), seeded to the id as an editable
	// default — it never resolves a Zone.
	const header =
		type === 'town'
			? { name: id, type, npcs: {}, portals: {} }
			: { name: id, type, spawns: {}, portals: {} };

	const rows: string[] = [];
	for (let y = 0; y < h - 1; y++) rows.push('.'.repeat(w));
	rows.push('#'.repeat(w)); // floor

	return `${JSON.stringify(header, null, 2)}\n---\n${rows.join('\n')}\n`;
}
