import { describe, expect, test } from 'bun:test';
import { type Catalogs, ZONE_MAX } from '@mmo/shared';
import type { EditorDoc } from '../src/doc';
import {
	clampRoam,
	cursorEdge,
	docDiagnostics,
	editorExtent,
	editorStatusLine,
	growToInclude,
	scrollAxis,
	scrollViewport,
	trimDoc,
} from '../src/editor';

const CATALOGS: Catalogs = {
	monsters: [{ id: 'chaser', behavior: 'chaser', name: 'Slime' }],
	npcs: [],
};

// A blank 5×3 field doc, floor on the bottom row.
function blank(): EditorDoc {
	return {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {}, portals: {} },
		rows: ['.....', '.....', '#####'],
	};
}

describe('editorExtent', () => {
	test('infers width from the longest row and height from the row count', () => {
		expect(editorExtent(blank())).toEqual({ w: 5, h: 3 });
	});
});

describe('growToInclude', () => {
	test('grows the canvas height to include a row below the content', () => {
		const grown = growToInclude(blank(), 2, 5);
		expect(grown.rows.length).toBe(6);
		// The original rows are untouched; the new rows are empty.
		expect(grown.rows.slice(0, 3)).toEqual(blank().rows);
		expect(grown.rows.slice(3)).toEqual(['', '', '']);
	});

	test('refuses to grow past the ZONE_MAX height cap', () => {
		const doc = blank();
		expect(growToInclude(doc, 0, ZONE_MAX.h)).toBe(doc);
		expect(growToInclude(doc, ZONE_MAX.w, 0)).toBe(doc);
		expect(growToInclude(doc, -1, 0)).toBe(doc);
	});
});

describe('trimDoc', () => {
	test('strips trailing empty cells per row and trailing empty rows', () => {
		// Erasing the far edge leaves redundant trailing dots and blank rows that
		// `parseZone` would treat as empty anyway — trimming shrinks the extent.
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field' },
			rows: ['##...', '.....', '#####', '.....', ''],
		};
		const trimmed = trimDoc(doc);
		expect(trimmed.rows).toEqual(['##', '', '#####']);
		expect(editorExtent(trimmed)).toEqual({ w: 5, h: 3 });
	});

	test('keeps the header untouched', () => {
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: { c: 'chaser' } },
			rows: ['c...'],
		};
		expect(trimDoc(doc).header).toEqual(doc.header);
	});
});

describe('clampRoam', () => {
	test('lets the cursor roam content plus a margin of virgin space', () => {
		// Extent is 5×3; a margin of 4 lets the cursor sit 4 cells beyond content.
		expect(clampRoam(blank(), 100, 100, 4)).toEqual({ x: 9, y: 7 });
	});

	test('clamps to the top-left origin', () => {
		expect(clampRoam(blank(), -3, -8, 4)).toEqual({ x: 0, y: 0 });
	});

	test('never roams past the ZONE_MAX cap', () => {
		// A margin wider than the whole world still can't push past the cap.
		const c = clampRoam(blank(), 1e9, 1e9, 1e9);
		expect(c).toEqual({ x: ZONE_MAX.w - 1, y: ZONE_MAX.h - 1 });
	});
});

describe('scrollAxis', () => {
	// viewLen 20, scrolloff 3: the comfortable band is [cam+3, cam+16].
	test('holds still while the cursor stays inside the scrolloff band', () => {
		expect(scrollAxis(0, 10, 20, 3)).toBe(0);
	});

	test('scrolls so the cursor keeps a scrolloff margin from the far edge', () => {
		expect(scrollAxis(0, 18, 20, 3)).toBe(2);
	});

	test('scrolls back toward the near edge, never past the origin', () => {
		expect(scrollAxis(10, 4, 20, 3)).toBe(1);
		expect(scrollAxis(10, 1, 20, 3)).toBe(0);
	});
});

describe('scrollViewport', () => {
	test('applies the scrolloff scroll independently on each axis', () => {
		expect(scrollViewport({ x: 0, y: 0 }, { x: 18, y: 1 }, 20, 20, 3)).toEqual({
			x: 2,
			y: 0,
		});
	});
});

describe('cursorEdge', () => {
	// A 20×10 viewport at the origin; the cursor is visible inside [0,20)×[0,10).
	test('reports no edge when the cursor is on screen', () => {
		expect(cursorEdge({ x: 5, y: 5 }, { x: 0, y: 0 }, 20, 10)).toEqual({
			dx: 0,
			dy: 0,
		});
	});

	test('points toward an off-screen cursor (free-panned away)', () => {
		// Pan the camera right + down so the cursor falls off the top-left.
		expect(cursorEdge({ x: 5, y: 5 }, { x: 30, y: 30 }, 20, 10)).toEqual({
			dx: -1,
			dy: -1,
		});
		// Cursor past the bottom-right margin.
		expect(cursorEdge({ x: 25, y: 12 }, { x: 0, y: 0 }, 20, 10)).toEqual({
			dx: 1,
			dy: 1,
		});
	});
});

describe('docDiagnostics', () => {
	test('a clean doc has no findings', () => {
		// A town needs no spawns, so a bare floored grid validates clean.
		const town: EditorDoc = {
			header: { id: 't', type: 'town' },
			rows: ['.....', '.....', '#####'],
		};
		expect(docDiagnostics(town, CATALOGS)).toEqual([]);
	});

	test('surfaces the same orphan-glyph error that `zone check` would', () => {
		// `c` is declared in the header but never placed in the grid.
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: { c: 'chaser' } },
			rows: ['.....', '#####'],
		};
		const diags = docDiagnostics(doc, CATALOGS);
		expect(diags.some((d) => d.severity === 'error')).toBe(true);
		expect(diags.some((d) => d.message.includes("'c'"))).toBe(true);
	});

	test('reports a single parse error for an unparseable doc', () => {
		// An all-empty grid fails `parseZone` (no cells).
		const doc: EditorDoc = { header: { id: 'z', type: 'field' }, rows: [] };
		const diags = docDiagnostics(doc, CATALOGS);
		expect(diags).toHaveLength(1);
		expect(diags[0].severity).toBe('error');
	});
});

describe('editorStatusLine', () => {
	test('shows the tool, placeable, cursor, dirty marker, and health', () => {
		const line = editorStatusLine({
			tool: 'Brush',
			placeable: 'Solid',
			cursor: { x: 3, y: 7 },
			dirty: true,
			diags: [{ severity: 'error', zoneId: 'z', message: 'boom' }],
		});
		expect(line).toContain('Brush');
		expect(line).toContain('Solid');
		expect(line).toContain('(3,7)');
		expect(line).toContain('*'); // unsaved marker
		expect(line).toContain('✗1'); // one error
	});

	test('shows a clean checkmark and no dirty marker when saved and healthy', () => {
		const line = editorStatusLine({
			tool: 'Brush',
			placeable: 'Solid',
			cursor: { x: 0, y: 0 },
			dirty: false,
			diags: [],
		});
		expect(line).toContain('✓');
		expect(line).not.toContain('*');
	});
});
