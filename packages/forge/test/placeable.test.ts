import { describe, expect, test } from 'bun:test';
import { type Catalogs, findOrphanGlyphs, parseZone } from '@mmo/shared';
import { cellAt, type EditorDoc, serializeDoc } from '../src/doc';
import { buildPalette, erase, place } from '../src/placeable';

const CATALOGS: Catalogs = {
	monsters: [
		{ id: 'chaser', behavior: 'chaser', name: 'Slime' },
		{ id: 'shooter', behavior: 'shooter', name: 'Sporeling' },
	],
	npcs: [{ id: 'merchant', kind: 'vendor', name: 'Merchant' }],
};

// A blank 5×3 field doc to place into.
function blank(): EditorDoc {
	return {
		header: { type: 'field', spawns: {}, npcs: {}, portals: {} },
		rows: ['.....', '.....', '#####'],
	};
}

// The glyph stamped into the grid for a given header entry (test convenience).
function glyphAt(doc: EditorDoc, x: number, y: number): string {
	return cellAt(doc, x, y);
}

describe('placing a Placeable declares + stamps it', () => {
	test('a never-before-used Monster adds its header entry and stamps a glyph', () => {
		const doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		const spawns = doc.header.spawns as Record<string, string>;
		const glyph = glyphAt(doc, 1, 1);
		expect(glyph).not.toBe('.');
		expect(spawns[glyph]).toBe('chaser'); // declared, mapped to the catalog id
	});

	test('Terrain stamps `#` and adds no header entry', () => {
		const doc = place(blank(), 2, 1, { kind: 'terrain' });
		expect(glyphAt(doc, 2, 1)).toBe('#');
		expect(doc.header.spawns).toEqual({});
	});

	test('an NPC declares under npcs, a Portal under portals', () => {
		let doc = place(blank(), 1, 0, { kind: 'npc', id: 'merchant' });
		doc = place(doc, 3, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [4, 9],
		});
		const npcGlyph = glyphAt(doc, 1, 0);
		const portalGlyph = glyphAt(doc, 3, 0);
		expect((doc.header.npcs as Record<string, string>)[npcGlyph]).toBe(
			'merchant',
		);
		expect(
			(doc.header.portals as Record<string, unknown>)[portalGlyph],
		).toEqual({ target: 'town-01', arrival: [4, 9] });
	});
});

describe('glyph allocation: one per type, reused across instances', () => {
	test('two instances of the same Monster share one glyph + one header entry', () => {
		let doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 3, 1, { kind: 'monster', id: 'chaser' });
		expect(glyphAt(doc, 1, 1)).toBe(glyphAt(doc, 3, 1));
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(1);
	});

	test('different Monsters get distinct glyphs', () => {
		let doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 3, 1, { kind: 'monster', id: 'shooter' });
		expect(glyphAt(doc, 1, 1)).not.toBe(glyphAt(doc, 3, 1));
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(2);
	});

	test('Portals with distinct configs get distinct glyphs; identical reuse one', () => {
		let doc = place(blank(), 0, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [1, 2],
		});
		doc = place(doc, 1, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [1, 2],
		}); // same config → reuse
		doc = place(doc, 2, 0, {
			kind: 'portal',
			target: 'field-02',
			arrival: [1, 2],
		}); // different target → new glyph
		expect(glyphAt(doc, 0, 0)).toBe(glyphAt(doc, 1, 0));
		expect(glyphAt(doc, 0, 0)).not.toBe(glyphAt(doc, 2, 0));
		expect(Object.keys(doc.header.portals as object)).toHaveLength(2);
	});
});

describe('erasing garbage-collects the header entry', () => {
	test('erasing the LAST instance of a Monster removes its header entry', () => {
		let doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		doc = erase(doc, 1, 1);
		expect(glyphAt(doc, 1, 1)).toBe('.');
		expect(doc.header.spawns).toEqual({}); // GC'd — no orphan declaration
	});

	test('erasing one of two instances keeps the header entry', () => {
		let doc = place(blank(), 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 3, 1, { kind: 'monster', id: 'chaser' });
		doc = erase(doc, 1, 1);
		expect(glyphAt(doc, 3, 1)).not.toBe('.'); // survivor still stamped
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(1);
	});

	test('erasing Terrain leaves header maps untouched', () => {
		let doc = place(blank(), 2, 1, { kind: 'terrain' });
		doc = erase(doc, 2, 1);
		expect(glyphAt(doc, 2, 1)).toBe('.');
		expect(doc.header.spawns).toEqual({});
	});
});

describe('orphan/undeclared glyph states are unreachable through the editor', () => {
	test('a place/erase sequence never leaves an orphan or undeclared glyph', () => {
		let doc = blank();
		doc = place(doc, 1, 1, { kind: 'monster', id: 'chaser' });
		doc = place(doc, 2, 1, { kind: 'monster', id: 'shooter' });
		doc = place(doc, 0, 0, { kind: 'npc', id: 'merchant' });
		doc = place(doc, 4, 0, {
			kind: 'portal',
			target: 'town-01',
			arrival: [2, 2],
		});
		doc = erase(doc, 2, 1); // remove the only shooter → its header entry GCs
		const text = serializeDoc(doc);
		// No declared-but-unused glyphs (orphans)…
		expect(findOrphanGlyphs(text)).toEqual([]);
		// …and every placed glyph is declared, so parseZone resolves cleanly.
		expect(() => parseZone(text, CATALOGS, 'z')).not.toThrow();
	});

	test('placing out of grid is a no-op and allocates no header entry', () => {
		const doc = place(blank(), 0, 9, { kind: 'monster', id: 'chaser' });
		expect(doc.header.spawns).toEqual({}); // no orphan from a failed stamp
	});
});

describe('Palette is generated from the catalog + structural primitives', () => {
	test('groups Terrain / Monsters / NPCs / Structures from the catalog', () => {
		const palette = buildPalette(CATALOGS);
		expect(palette.map((g) => g.label)).toEqual([
			'Terrain',
			'Monsters',
			'NPCs',
			'Structures',
		]);
		const monsters = palette.find((g) => g.label === 'Monsters');
		expect(monsters?.items.map((i) => i.label)).toEqual(['Slime', 'Sporeling']);
		expect(monsters?.items[0].placeable).toEqual({
			kind: 'monster',
			id: 'chaser',
		});
	});

	test('Structures group exposes stub slots (no placeable yet)', () => {
		const structures = buildPalette(CATALOGS).find(
			(g) => g.label === 'Structures',
		);
		expect(structures?.items.map((i) => i.label)).toEqual([
			'Portal',
			'Spawn',
			'Respawn',
		]);
		expect(structures?.items.every((i) => i.placeable === undefined)).toBe(
			true,
		);
	});
});
