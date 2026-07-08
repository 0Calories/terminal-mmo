import { describe, expect, test } from 'bun:test';
import {
	cellAt,
	clearCell,
	type EditorDoc,
	parseDoc,
	placedMonsterCount,
	placeGlyph,
	serializeDoc,
	setZoneName,
	setZoneType,
	toggleSolid,
	zoneName,
	zoneType,
} from '../src/doc';
import { newZoneTemplate } from '../src/template';

const sample: EditorDoc = {
	header: { id: 'z', type: 'field' },
	rows: ['...', '###'],
};

describe('EditorDoc round-trip', () => {
	test('serializeDoc(parseDoc(text)) reproduces canonical .zone text', () => {
		const text = newZoneTemplate('field-7', 'field');
		expect(serializeDoc(parseDoc(text))).toBe(text);
	});

	test('parseDoc rejects a missing delimiter and a bad header', () => {
		expect(() => parseDoc('{"id":"z"}\n...\n')).toThrow('delimiter');
		expect(() => parseDoc('{not json}\n---\n...\n')).toThrow('JSON');
	});
});

describe('lossless where parseZone is not', () => {
	test('header keys parseZone discards survive a parse→serialize round-trip', () => {
		// `z` is declared but never placed (an orphan key parseZone drops); `loot`
		// is a field parseZone never reads. Both must come back unchanged.
		const text =
			'{\n  "id": "z",\n  "type": "field",\n  "spawns": {\n    "z": "slime"\n  },\n  "loot": "gold"\n}\n---\n...\n###\n';
		const doc = parseDoc(text);
		expect(doc.header).toEqual({
			id: 'z',
			type: 'field',
			spawns: { z: 'slime' },
			loot: 'gold',
		});
		expect(serializeDoc(doc)).toBe(text);
	});
});

describe('grid edit ops', () => {
	test('toggleSolid flips an empty cell to solid and back', () => {
		const solid = toggleSolid(sample, 1, 0);
		expect(cellAt(solid, 1, 0)).toBe('#');
		expect(cellAt(toggleSolid(solid, 1, 0), 1, 0)).toBe('.');
	});

	test('placeGlyph stamps a glyph and clearCell resets it to empty', () => {
		const placed = placeGlyph(sample, 0, 0, 'c');
		expect(cellAt(placed, 0, 0)).toBe('c');
		expect(cellAt(clearCell(placed, 0, 0), 0, 0)).toBe('.');
	});

	test('placing past a row end pads the row with empty cells', () => {
		const placed = placeGlyph(sample, 5, 0, 'P'); // row 0 is only 3 wide
		expect(placed.rows[0]).toBe('...' + '..' + 'P'); // padded to '.....P'
		expect(cellAt(placed, 5, 0)).toBe('P');
	});

	test('edit ops do not mutate the input doc', () => {
		const before = sample.rows[0];
		toggleSolid(sample, 0, 0);
		expect(sample.rows[0]).toBe(before);
	});
});

describe('header: display name + type (#99)', () => {
	test('zoneName reads the optional name (undefined when absent)', () => {
		expect(zoneName(sample)).toBeUndefined();
		expect(zoneName({ header: { id: 'z', name: 'Hub' }, rows: [] })).toBe(
			'Hub',
		);
	});

	test('setZoneName sets a trimmed name and round-trips losslessly', () => {
		const named = setZoneName(sample, '  Sunny Meadow  ');
		expect(zoneName(named)).toBe('Sunny Meadow');
		expect(zoneName(parseDoc(serializeDoc(named)))).toBe('Sunny Meadow');
	});

	test('setZoneName with an empty/whitespace name removes the key', () => {
		const named = setZoneName(sample, 'Hub');
		const cleared = setZoneName(named, '   ');
		expect('name' in cleared.header).toBe(false);
	});

	test('setZoneName does not mutate the input doc', () => {
		setZoneName(sample, 'X');
		expect('name' in sample.header).toBe(false);
	});

	test('zoneType reads the type; setZoneType flips it immutably', () => {
		expect(zoneType(sample)).toBe('field');
		const town = setZoneType(sample, 'town');
		expect(zoneType(town)).toBe('town');
		expect(zoneType(sample)).toBe('field'); // input untouched
	});

	test('placedMonsterCount counts grid cells anchored to a spawn glyph', () => {
		const doc: EditorDoc = {
			header: { id: 'f', type: 'field', spawns: { c: 'goblin', s: 'archer' } },
			rows: ['..c..s..c', '#########'],
		};
		expect(placedMonsterCount(doc)).toBe(3);
		// undeclared glyphs and terrain don't count; no spawns map → 0
		expect(placedMonsterCount(sample)).toBe(0);
		expect(
			placedMonsterCount({ header: { id: 'f', type: 'field' }, rows: ['ccc'] }),
		).toBe(0);
	});
});
