import type { ZoneType } from '@mmo/core/zones';

const SIZE: Record<ZoneType, { w: number; h: number }> = {
	field: { w: 60, h: 16 },
	town: { w: 40, h: 16 },
	dungeon: { w: 60, h: 16 },
};

export function newZoneTemplate(id: string, type: ZoneType): string {
	const { w, h } = SIZE[type];
	const header =
		type === 'town'
			? { name: id, type, npcs: {}, portals: {} }
			: { name: id, type, spawns: {}, portals: {} };

	const rows: string[] = [];
	for (let y = 0; y < h - 1; y++) rows.push('.'.repeat(w));
	rows.push('#'.repeat(w));

	return `${JSON.stringify(header, null, 2)}\n---\n${rows.join('\n')}\n`;
}
