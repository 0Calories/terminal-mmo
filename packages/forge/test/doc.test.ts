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

const sample = (): EditorDoc => ({
	header: { type: 'field', spawns: { c: 'slime' } },
	rows: ['.....', '#####'],
});

describe('Zone document transformations', () => {
	test('a canonical template parses and serializes byte-for-byte', () => {
		const text = newZoneTemplate('field-7', 'field');
		expect(serializeDoc(parseDoc(text))).toBe(text);
	});

	test('completed metadata and grid edits survive serialization and parsing', () => {
		let authored = setZoneName(sample(), '  Sunny Meadow  ');
		authored = setZoneType(authored, 'town');
		authored = toggleSolid(authored, 1, 0);
		authored = placeGlyph(authored, 3, 0, 'c');
		authored = clearCell(authored, 1, 0);

		const reparsed = parseDoc(serializeDoc(authored));
		expect(zoneName(reparsed)).toBe('Sunny Meadow');
		expect(zoneType(reparsed)).toBe('town');
		expect(cellAt(reparsed, 1, 0)).toBe('.');
		expect(cellAt(reparsed, 3, 0)).toBe('c');
		expect(placedMonsterCount(reparsed)).toBe(1);
	});

	test('placing beyond a short row preserves the requested cell in the saved grid', () => {
		const reparsed = parseDoc(serializeDoc(placeGlyph(sample(), 8, 0, 'c')));
		expect(cellAt(reparsed, 8, 0)).toBe('c');
	});

	test('clearing a display name removes it from the serialized header', () => {
		const cleared = setZoneName(setZoneName(sample(), 'Hub'), '   ');
		const reparsed = parseDoc(serializeDoc(cleared));
		expect(zoneName(reparsed)).toBeUndefined();
		expect('name' in reparsed.header).toBe(false);
	});

	test('unknown header data is preserved losslessly', () => {
		const text =
			'{\n  "type": "field",\n  "spawns": {\n    "z": "slime"\n  },\n  "loot": "gold"\n}\n---\n...\n###\n';
		expect(serializeDoc(parseDoc(text))).toBe(text);
	});
});

describe('Zone document format laws', () => {
	test.each([
		['missing delimiter', '{"type":"field"}\n...\n', 'delimiter'],
		['malformed JSON header', '{not json}\n---\n...\n', 'JSON'],
	] as const)('rejects %s', (_, text, message) => {
		expect(() => parseDoc(text)).toThrow(message);
	});
});
