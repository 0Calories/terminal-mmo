import { describe, expect, test } from 'bun:test';
import type { Catalogs } from '@mmo/shared';
import type { EditorDoc } from '../src/doc';
import {
	clampCursor,
	commit,
	declaredGlyphs,
	docDiagnostics,
	editStatusLine,
	gridSize,
	initHistory,
	undo,
} from '../src/edit';

const docWith = (
	header: Record<string, unknown>,
	rows: string[],
): EditorDoc => ({
	header,
	rows,
});

describe('declaredGlyphs', () => {
	test('collects spawn/npc/portal keys, sorted and unique', () => {
		const doc = docWith(
			{
				id: 'z',
				type: 'field',
				spawns: { c: 'chaser', s: 'shooter' },
				npcs: { M: 'merchant' },
				portals: { P: { target: 'town-01' } },
			},
			['...', '###'],
		);
		expect(declaredGlyphs(doc)).toEqual(['M', 'P', 'c', 's']);
	});

	test('a header with no declarations yields no stampable glyphs', () => {
		expect(declaredGlyphs(docWith({ id: 'z', type: 'town' }, ['###']))).toEqual(
			[],
		);
	});
});

describe('grid cursor bounds', () => {
	const doc = docWith({}, ['.....', '##']); // ragged: width = longest row

	test('gridSize is the longest row by the row count', () => {
		expect(gridSize(doc)).toEqual({ w: 5, h: 2 });
	});

	test('clampCursor keeps the cursor inside the grid', () => {
		expect(clampCursor(doc, 9, 9)).toEqual({ x: 4, y: 1 });
		expect(clampCursor(doc, -3, -1)).toEqual({ x: 0, y: 0 });
	});

	test('an empty grid pins the cursor at the origin', () => {
		expect(clampCursor(docWith({}, []), 4, 4)).toEqual({ x: 0, y: 0 });
	});
});

describe('undo history', () => {
	const a = docWith({}, ['..']);
	const b = docWith({}, ['#.']);
	const c = docWith({}, ['##']);

	test('undo steps the present back through committed snapshots', () => {
		const h = commit(commit(initHistory(a), b), c);
		expect(h.present).toBe(c);
		expect(undo(h).present).toBe(b);
		expect(undo(undo(h)).present).toBe(a);
	});

	test('undo on the initial state is a no-op', () => {
		const h = initHistory(a);
		expect(undo(h).present).toBe(a);
	});
});

describe('docDiagnostics (live validation panel)', () => {
	const catalogs: Catalogs = {
		monsters: [{ id: 'chaser', behavior: 'chaser', name: 'Chaser' }],
		npcs: [],
	};
	// `c`'s 5×5 spawn box (rows 2–6) rests on the floor at row 7 — a clean field.
	const cleanRows = [
		'............',
		'............',
		'..c.........',
		'............',
		'............',
		'............',
		'............',
		'############',
	];

	test('a valid doc reports no errors', () => {
		const doc = docWith(
			{ id: 'f', type: 'field', spawns: { c: 'chaser' } },
			cleanRows,
		);
		expect(
			docDiagnostics(doc, catalogs).filter((d) => d.severity === 'error'),
		).toEqual([]);
	});

	test('an orphan header glyph surfaces as an error', () => {
		const doc = docWith(
			{ id: 'f', type: 'field', spawns: { c: 'chaser', z: 'chaser' } },
			cleanRows,
		);
		const diags = docDiagnostics(doc, catalogs);
		expect(diags.some((d) => d.message.includes("'z'"))).toBe(true);
	});

	test('an unparseable doc surfaces a single parse error', () => {
		// `Q` in the grid is declared nowhere — parseZone rejects the unknown glyph.
		const doc = docWith({ id: 'f', type: 'field', spawns: { c: 'chaser' } }, [
			'.......Q....',
			'............',
			'..c.........',
			'............',
			'............',
			'............',
			'............',
			'############',
		]);
		const diags = docDiagnostics(doc, catalogs);
		expect(diags).toHaveLength(1);
		expect(diags[0].message).toContain('parse failed');
	});
});

describe('editStatusLine', () => {
	const doc = docWith({ id: 'f', type: 'field' }, ['###']);

	test('reports a clean doc with a ✓ and no unsaved marker', () => {
		const line = editStatusLine(doc, { x: 1, y: 2 }, 'c', [], false);
		expect(line).toContain('edit f ');
		expect(line).toContain('(1,2)');
		expect(line).toContain("stamp 'c'");
		expect(line).toContain('✓');
	});

	test('shows the unsaved marker and the first error message', () => {
		const line = editStatusLine(
			doc,
			{ x: 0, y: 0 },
			'',
			[
				{ severity: 'error', zoneId: 'f', message: 'boom' },
				{ severity: 'error', zoneId: 'f', message: 'second' },
			],
			true,
		);
		expect(line).toContain('edit f*');
		expect(line).toContain('✗ 2: boom');
	});
});
