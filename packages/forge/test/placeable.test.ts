import { describe, expect, test } from 'bun:test';
import { type Catalogs, findOrphanGlyphs, parseZone } from '@mmo/core/zones';
import { cellAt, type EditorDoc, serializeDoc } from '../src/doc';
import { buildPalette, erase, place } from '../src/placeable';

const CATALOGS: Catalogs = {
	monsters: [
		{ id: 'chaser', behavior: 'chaser', name: 'Slime' },
		{ id: 'shooter', behavior: 'shooter', name: 'Sporeling' },
	],
	npcs: [{ id: 'merchant', kind: 'vendor', name: 'Merchant' }],
};

function blank(): EditorDoc {
	return {
		header: { type: 'field', spawns: {}, npcs: {}, portals: {} },
		rows: ['.....', '.....', '#####'],
	};
}

describe('completed Placeable operations', () => {
	test('placing a mixed Zone produces a parseable document with semantic entities and no orphan glyphs', () => {
		let doc = place(blank(), 0, 0, { kind: 'terrain' });
		doc = place(doc, 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 2, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 3, 1, { kind: 'monster', id: 'shooter' });
		doc = place(doc, 1, 0, { kind: 'npc', id: 'merchant' });
		doc = place(doc, 3, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [4, 9],
		});

		const text = serializeDoc(doc);
		expect(findOrphanGlyphs(text)).toEqual([]);
		const zone = parseZone(text, CATALOGS, 'field-test');
		expect(zone.terrain.cells[0]).not.toBe(0);
		expect(zone.monsters.map((monster) => monster.type).sort()).toEqual([
			'chaser',
			'chaser',
			'shooter',
		]);
		expect(zone.npcs).toHaveLength(1);
		expect(zone.portals[0]).toMatchObject({
			x: 3,
			y: 0,
			target: 'town-01',
			arrival: { x: 4, y: 9 },
		});
	});

	test('equal Placeables share a glyph while distinct semantic values remain distinct', () => {
		let doc = place(blank(), 0, 0, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 1, 0, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 2, 0, { kind: 'monster', id: 'shooter' });
		doc = place(doc, 3, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [1, 2],
		});
		doc = place(doc, 4, 0, {
			kind: 'portal',
			target: 'field-02',
			arrival: [1, 2],
		});

		expect(cellAt(doc, 0, 0)).toBe(cellAt(doc, 1, 0));
		expect(cellAt(doc, 0, 0)).not.toBe(cellAt(doc, 2, 0));
		expect(cellAt(doc, 3, 0)).not.toBe(cellAt(doc, 4, 0));
	});

	test('erasing instances garbage-collects a mapping only after its final use', () => {
		let doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 3, 1, { kind: 'monster', id: 'chaser' });
		const glyph = cellAt(doc, 1, 1);
		doc = erase(doc, 1, 1);
		expect((doc.header.spawns as Record<string, string>)[glyph]).toBe('chaser');
		doc = erase(doc, 3, 1);
		expect(
			(doc.header.spawns as Record<string, string>)[glyph],
		).toBeUndefined();
		expect(findOrphanGlyphs(serializeDoc(doc))).toEqual([]);
	});

	test('placing outside the authored grid changes neither grid nor header', () => {
		const before = blank();
		expect(place(before, 0, 9, { kind: 'monster', id: 'chaser' })).toBe(before);
	});
});

describe('Palette model', () => {
	test('catalog Placeables are derived from catalog identity rather than a hand-maintained inventory', () => {
		const items = buildPalette(CATALOGS).flatMap((group) => group.items);
		expect(
			items.flatMap((item) =>
				item.placeable?.kind === 'monster' ? [item.placeable.id] : [],
			),
		).toEqual(['chaser', 'shooter']);
		expect(
			items.flatMap((item) =>
				item.placeable?.kind === 'npc' ? [item.placeable.id] : [],
			),
		).toEqual(['merchant']);
		expect(items.some((item) => item.placeable?.kind === 'terrain')).toBe(true);
	});
});
