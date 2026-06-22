import type { ZoneType } from '@mmo/shared';

/** Sane default canvas for a fresh Zone — wide enough to scroll, with a floor. */
const SIZE: Record<ZoneType, { w: number; h: number }> = {
	field: { w: 60, h: 16 },
	town: { w: 40, h: 16 },
};

/**
 * Emit a blank-grid `.zone` template: a valid header plus a `.`-filled grid with
 * a solid floor row, ready to edit. A `town` template validates clean; a `field`
 * template's only error is the missing spawn (the expected next edit). Pure.
 */
export function newZoneTemplate(id: string, type: ZoneType): string {
	const { w, h } = SIZE[type];
	const header =
		type === 'field'
			? { id, type, spawns: {}, portals: {} }
			: { id, type, npcs: {}, portals: {} };

	const rows: string[] = [];
	for (let y = 0; y < h - 1; y++) rows.push('.'.repeat(w));
	rows.push('#'.repeat(w)); // floor

	return `${JSON.stringify(header, null, 2)}\n---\n${rows.join('\n')}\n`;
}
