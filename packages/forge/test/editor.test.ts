import { describe, expect, test } from 'bun:test';
import {
	type Catalogs,
	findOrphanGlyphs,
	NPC_BOX,
	ZONE_MAX,
} from '@mmo/shared';
import { cellAt, type EditorDoc, serializeDoc } from '../src/doc';
import {
	clampRoam,
	copyRegion,
	cursorEdge,
	cursorToAnchor,
	deleteRegion,
	docDiagnostics,
	editorExtent,
	editorStatusLine,
	entityAt,
	eraseCells,
	footprintBox,
	ghostEntity,
	groundSnap,
	growToInclude,
	lineCells,
	moveRegion,
	paintCells,
	pasteClip,
	placeableAt,
	placementState,
	rectCells,
	scrollAxis,
	scrollViewport,
	TOOLS,
	toolByKey,
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

// --- Modal tools (#95) --------------------------------------------------------

const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
const setOf = (cs: { x: number; y: number }[]) => new Set(cs.map(key));

// A doc with one floored row plus blank space above, header maps present.
function field(rows: string[]): EditorDoc {
	return {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {}, portals: {} },
		rows,
	};
}

describe('TOOLS / toolByKey', () => {
	test('offers the six modal tools (Eyedropper dropped, Stamp added — #114)', () => {
		expect(TOOLS.map((t) => t.id)).toEqual([
			'brush',
			'eraser',
			'rectangle',
			'line',
			'select',
			'stamp',
		]);
	});

	test('every tool is reachable with no mouse — by its key and by 1-6', () => {
		TOOLS.forEach((t, i) => {
			expect(toolByKey(t.key)?.id).toBe(t.id);
			expect(toolByKey(String(i + 1))?.id).toBe(t.id);
		});
	});

	test('an unbound key resolves to no tool', () => {
		expect(toolByKey('z')).toBeUndefined();
		expect(toolByKey('9')).toBeUndefined();
		expect(toolByKey('left')).toBeUndefined();
	});
});

describe('rectCells', () => {
	test('fills the rectangle spanning two corners, order-independent', () => {
		const expected = setOf([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
		]);
		expect(setOf(rectCells({ x: 0, y: 0 }, { x: 2, y: 1 }))).toEqual(expected);
		expect(setOf(rectCells({ x: 2, y: 1 }, { x: 0, y: 0 }))).toEqual(expected);
	});

	test('a single cell when both corners coincide', () => {
		expect(rectCells({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
	});
});

describe('lineCells', () => {
	test('a horizontal floor includes both endpoints', () => {
		expect(setOf(lineCells({ x: 1, y: 3 }, { x: 4, y: 3 }))).toEqual(
			setOf([
				{ x: 1, y: 3 },
				{ x: 2, y: 3 },
				{ x: 3, y: 3 },
				{ x: 4, y: 3 },
			]),
		);
	});

	test('a vertical wall includes both endpoints', () => {
		expect(setOf(lineCells({ x: 2, y: 0 }, { x: 2, y: 2 }))).toEqual(
			setOf([
				{ x: 2, y: 0 },
				{ x: 2, y: 1 },
				{ x: 2, y: 2 },
			]),
		);
	});

	test('a diagonal steps one cell per axis (Bresenham)', () => {
		expect(lineCells({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 2, y: 2 },
		]);
	});

	test('a single cell when both endpoints coincide', () => {
		expect(lineCells({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
	});
});

describe('paintCells', () => {
	test('a wall is one rectangle stroke — terrain fills and grows the canvas', () => {
		// A 5×3 field; paint a solid block reaching down past the content.
		const doc = paintCells(
			field(['.....', '.....', '#####']),
			rectCells({ x: 0, y: 0 }, { x: 1, y: 4 }),
			{ kind: 'terrain' },
		);
		expect(doc.rows.length).toBe(5); // grew to include y=4
		for (const c of rectCells({ x: 0, y: 0 }, { x: 1, y: 4 }))
			expect(cellAt(doc, c.x, c.y)).toBe('#');
	});

	test('painting one monster across cells reuses a single glyph', () => {
		const doc = paintCells(
			field(['.....', '#####']),
			[
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
			],
			{ kind: 'monster', id: 'chaser' },
		);
		const spawns = doc.header.spawns as Record<string, unknown>;
		expect(Object.keys(spawns)).toHaveLength(1);
		const g = Object.keys(spawns)[0];
		expect(cellAt(doc, 0, 0)).toBe(g);
		expect(cellAt(doc, 2, 0)).toBe(g);
	});
});

describe('eraseCells', () => {
	test('erasing every instance garbage-collects the header entry', () => {
		let doc = paintCells(
			field(['.....', '#####']),
			[
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
			],
			{ kind: 'monster', id: 'chaser' },
		);
		doc = eraseCells(doc, [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
		]);
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(0);
	});
});

describe('placeableAt (eyedropper)', () => {
	const doc: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: { a: 'chaser' }, npcs: {} },
		rows: ['a#..', '####'],
	};

	test('adopts terrain under a `#`', () => {
		expect(placeableAt(doc, 1, 0)).toEqual({ kind: 'terrain' });
	});

	test('adopts the catalog Placeable behind a declared glyph', () => {
		expect(placeableAt(doc, 0, 0)).toEqual({ kind: 'monster', id: 'chaser' });
	});

	test('adopts nothing over an empty cell', () => {
		expect(placeableAt(doc, 2, 0)).toBeUndefined();
	});

	test('adopts nothing over an undeclared glyph', () => {
		expect(
			placeableAt({ ...doc, rows: ['z...', '####'] }, 0, 0),
		).toBeUndefined();
	});
});

describe('copyRegion / pasteClip', () => {
	const src: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: { a: 'chaser' }, npcs: {} },
		rows: ['a#...', '.....', '#####'],
	};

	test('captures only the non-empty Placeables in the region', () => {
		const clip = copyRegion(src, { x: 0, y: 0 }, { x: 2, y: 0 });
		expect(clip.w).toBe(3);
		expect(clip.h).toBe(1);
		// `a` and `#` captured, the trailing `.` skipped.
		expect(clip.cells).toHaveLength(2);
	});

	test('pastes the Placeables (not raw glyphs) at the new top-left', () => {
		const clip = copyRegion(src, { x: 0, y: 0 }, { x: 1, y: 0 });
		const doc = pasteClip(src, clip, 3, 1);
		expect(placeableAt(doc, 3, 1)).toEqual({ kind: 'monster', id: 'chaser' });
		expect(cellAt(doc, 4, 1)).toBe('#');
		// The same monster id reuses its single header glyph — no duplicate, no orphan.
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(1);
		expect(findOrphanGlyphs(serializeDoc(doc))).toEqual([]);
	});
});

describe('deleteRegion', () => {
	test('clears the region and GCs glyphs that vanish', () => {
		const doc = deleteRegion(
			{
				header: { id: 'z', type: 'field', spawns: { a: 'chaser' }, npcs: {} },
				rows: ['a#..', '####'],
			},
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		);
		expect(cellAt(doc, 0, 0)).toBe('.');
		expect(cellAt(doc, 1, 0)).toBe('.');
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(0);
	});
});

describe('footprintBox (#96)', () => {
	test('monster is the engine 5×5 collision box anchored top-left at the glyph', () => {
		expect(footprintBox({ kind: 'monster', id: 'chaser' }, 3, 2)).toEqual({
			x: 3,
			y: 2,
			w: 5,
			h: 5,
		});
	});

	test('npc is 4×5 and portal is 4×7 — matching what parseZone builds', () => {
		expect(footprintBox({ kind: 'npc', id: 'merchant' }, 0, 0)).toEqual({
			x: 0,
			y: 0,
			w: 4,
			h: 5,
		});
		expect(
			footprintBox({ kind: 'portal', target: 't', arrival: [0, 0] }, 1, 1),
		).toEqual({ x: 1, y: 1, w: 4, h: 7 });
	});

	test('terrain is a single cell (no real footprint)', () => {
		expect(footprintBox({ kind: 'terrain' }, 7, 4)).toEqual({
			x: 7,
			y: 4,
			w: 1,
			h: 1,
		});
	});
});

describe('ghostEntity (#118)', () => {
	const cats: Catalogs = {
		monsters: [{ id: 'chaser', behavior: 'chaser', name: 'Slime' }],
		npcs: [{ id: 'merchant', kind: 'vendor', name: 'Pemberton' }],
	};

	test('a monster ghost is the very Entity parseZone would spawn at the anchor', () => {
		const g = ghostEntity(cats, { kind: 'monster', id: 'chaser' }, 3, 2);
		expect(g?.kind).toBe('entity');
		if (g?.kind !== 'entity') throw new Error('expected entity');
		// behaviour-typed sprite, placed at the glyph anchor — no drift from spawn.
		expect(g.entity.type).toBe('chaser');
		expect(g.entity.x).toBe(3);
		expect(g.entity.y).toBe(2);
	});

	test('an NPC ghost carries the catalog kind + box at the anchor', () => {
		const g = ghostEntity(cats, { kind: 'npc', id: 'merchant' }, 1, 4);
		expect(g?.kind).toBe('npc');
		if (g?.kind !== 'npc') throw new Error('expected npc');
		expect(g.npc.kind).toBe('vendor');
		expect(g.npc.x).toBe(1);
		expect(g.npc.y).toBe(4);
		expect(g.npc.w).toBe(NPC_BOX.w);
		expect(g.npc.h).toBe(NPC_BOX.h);
	});

	test('kinds with no sprite preview yet (portal, unknown id) return undefined', () => {
		expect(
			ghostEntity(cats, { kind: 'portal', target: 't', arrival: [0, 0] }, 0, 0),
		).toBeUndefined();
		expect(
			ghostEntity(cats, { kind: 'monster', id: 'nope' }, 0, 0),
		).toBeUndefined();
	});
});

describe('placementState (#96)', () => {
	// A 10-wide field: empty headroom with a solid floor on the bottom row.
	const grounded: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
		rows: [
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'##########',
		],
	};
	// Taller: floor only on the last row, so a box up top floats above it.
	const tall: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
		rows: [
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'##########',
		],
	};

	test('green: a monster resting on the floor is grounded', () => {
		// Box rows 0-4, the cell below (row 5) is solid terrain.
		expect(
			placementState(grounded, { kind: 'monster', id: 'chaser' }, 2, 0),
		).toBe('grounded');
	});

	test('blue: a monster with no solid beneath its feet is airborne', () => {
		// Box rows 0-4, row 5 is empty and in-grid → floating, not invalid.
		expect(placementState(tall, { kind: 'monster', id: 'chaser' }, 0, 0)).toBe(
			'airborne',
		);
	});

	test('red: a footprint overlapping solid terrain is invalid', () => {
		const clipsFloor: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: ['..........', '..........', '##########', '##########'],
		};
		// Box rows 1-5 overlaps the solid rows 2-3.
		expect(
			placementState(clipsFloor, { kind: 'monster', id: 'chaser' }, 0, 1),
		).toBe('invalid');
	});

	test('red: a footprint extending past the canvas edge is invalid', () => {
		// x 8 + width 5 = 13 > the 10-wide grid.
		expect(
			placementState(grounded, { kind: 'monster', id: 'chaser' }, 8, 0),
		).toBe('invalid');
	});

	test('grounded uses the engine floor: a box at the canvas bottom rests on it', () => {
		const flat: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: [
				'..........',
				'..........',
				'..........',
				'..........',
				'..........',
			],
		};
		// Box rows 0-4 fill the whole grid; the cell below (row 5) is the world floor.
		expect(placementState(flat, { kind: 'monster', id: 'chaser' }, 0, 0)).toBe(
			'grounded',
		);
	});

	test('portals never need ground — fitting + not clipping is grounded', () => {
		const wide: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: Array(8).fill('..........'),
		};
		expect(
			placementState(
				wide,
				{ kind: 'portal', target: 't', arrival: [0, 0] },
				0,
				0,
			),
		).toBe('grounded');
	});
});

describe('groundSnap (#96)', () => {
	const tall: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
		rows: [
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'##########',
		],
	};

	test('seats a floating monster so its feet rest on the nearest solid below', () => {
		// Floor is row 7; a 5-tall box must anchor at row 2 (rows 2-6, below = row 7).
		expect(groundSnap(tall, { kind: 'monster', id: 'chaser' }, 0, 0)).toEqual({
			x: 0,
			y: 2,
		});
	});

	test('an already-grounded anchor is left unchanged', () => {
		expect(groundSnap(tall, { kind: 'monster', id: 'chaser' }, 0, 2)).toEqual({
			x: 0,
			y: 2,
		});
	});

	test('with no terrain below, snaps onto the canvas floor', () => {
		const empty: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: Array(8).fill('..........'),
		};
		// Floor is the implicit cell below row 7 (== height 8) → anchor row 3.
		expect(groundSnap(empty, { kind: 'monster', id: 'chaser' }, 0, 0)).toEqual({
			x: 0,
			y: 3,
		});
	});

	test('terrain is never snapped', () => {
		expect(groundSnap(tall, { kind: 'terrain' }, 4, 1)).toEqual({ x: 4, y: 1 });
	});

	test('a cursor far above any surface stays put rather than falling to it (#117)', () => {
		// 5-tall box at row 0 → feet at row 4; the only ground is the canvas floor
		// far below (row 16). That drop is well past the snap cap, so the box keeps
		// the author's feet anchor (airborne) instead of teleporting to the floor.
		const skyHigh: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: Array(16).fill('..........'),
		};
		expect(
			groundSnap(skyHigh, { kind: 'monster', id: 'chaser' }, 0, 0),
		).toEqual({
			x: 0,
			y: 0,
		});
	});

	test('still snaps when a surface is within the cap distance (#117)', () => {
		// Feet at row 4, floor at row 8 → a 3-cell drop (within the cap) snaps.
		const near: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: Array(8).fill('..........'),
		};
		expect(groundSnap(near, { kind: 'monster', id: 'chaser' }, 0, 0)).toEqual({
			x: 0,
			y: 3,
		});
	});
});

describe('cursorToAnchor (#114)', () => {
	// Floor on the bottom row; ample headroom above it.
	const field: EditorDoc = {
		header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
		rows: [
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'..........',
			'##########',
		],
	};
	const monster = { kind: 'monster', id: 'chaser' } as const;

	test('x is always the cursor minus half the box width', () => {
		// 5-wide box → floor(5/2) = 2, so the cursor sits at the box centre column.
		expect(cursorToAnchor(field, monster, 5, 5, true).x).toBe(3);
	});

	test('free-place centres the box on the cursor (no snap)', () => {
		// 5×5 box → anchor = cursor - (2,2), mid-air, untouched by ground.
		expect(cursorToAnchor(field, monster, 5, 5, true)).toEqual({ x: 3, y: 3 });
	});

	test('ground-snap seats the box feet at the cursor, then drops to the surface', () => {
		// Feet anchor y = 5 - (5-1) = 1 (box rows 1-5); the floor is row 7, so the
		// box drops until its bottom rests above it → anchor row 2 (rows 2-6).
		expect(cursorToAnchor(field, monster, 5, 5, false)).toEqual({ x: 3, y: 2 });
	});

	test('terrain (1×1) maps the cursor straight to the anchor either way', () => {
		const terrain = { kind: 'terrain' } as const;
		expect(cursorToAnchor(field, terrain, 4, 6, true)).toEqual({ x: 4, y: 6 });
		expect(cursorToAnchor(field, terrain, 4, 6, false)).toEqual({ x: 4, y: 6 });
	});
});

describe('entityAt (#114)', () => {
	test('a click anywhere in the footprint resolves the entity at its origin', () => {
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: { c: 'chaser' }, npcs: {} },
			rows: [
				'c.........',
				'..........',
				'..........',
				'..........',
				'..........',
			],
		};
		// Monster origin is (0,0); its 5×5 footprint covers (3,3).
		expect(entityAt(doc, 3, 3)).toEqual({
			originX: 0,
			originY: 0,
			placeable: { kind: 'monster', id: 'chaser' },
		});
	});

	test('a cell outside every footprint resolves to nothing', () => {
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: { c: 'chaser' }, npcs: {} },
			rows: [
				'c.........',
				'..........',
				'..........',
				'..........',
				'..........',
			],
		};
		expect(entityAt(doc, 6, 0)).toBeUndefined();
	});

	test('an empty cell with no entity above-left resolves to nothing', () => {
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: {}, npcs: {} },
			rows: ['.....', '.....', '#####'],
		};
		expect(entityAt(doc, 2, 0)).toBeUndefined();
	});

	test('on overlap the renderer-topmost (monster over npc) wins', () => {
		// Monster 'c' at (0,0) [cols 0-4] and NPC 'm' at (2,0) [cols 2-5] both cover
		// (3,3); the monster draws on top, so it is the one erased.
		const doc: EditorDoc = {
			header: {
				id: 'z',
				type: 'field',
				spawns: { c: 'chaser' },
				npcs: { m: 'merchant' },
			},
			rows: [
				'c.m.......',
				'..........',
				'..........',
				'..........',
				'..........',
			],
		};
		expect(entityAt(doc, 3, 3)?.placeable).toEqual({
			kind: 'monster',
			id: 'chaser',
		});
	});

	test('among same-layer entities the lower one (larger anchor y) wins', () => {
		// Two monsters whose 5×5 footprints overlap at (2,4); the one anchored lower
		// (origin y 2) is drawn later → on top.
		const doc: EditorDoc = {
			header: { id: 'z', type: 'field', spawns: { c: 'chaser' }, npcs: {} },
			rows: [
				'c.........',
				'..........',
				'c.........',
				'..........',
				'..........',
				'..........',
				'..........',
			],
		};
		expect(entityAt(doc, 2, 4)?.originY).toBe(2);
	});
});

describe('moveRegion', () => {
	test('relocates a Placeable block, leaving no orphan or duplicate', () => {
		const doc = moveRegion(
			{
				header: { id: 'z', type: 'field', spawns: { a: 'chaser' }, npcs: {} },
				rows: ['a....', '.....', '#####'],
			},
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			2,
			1,
		);
		expect(placeableAt(doc, 0, 0)).toBeUndefined();
		expect(placeableAt(doc, 2, 1)).toEqual({ kind: 'monster', id: 'chaser' });
		expect(Object.keys(doc.header.spawns as object)).toHaveLength(1);
		expect(findOrphanGlyphs(serializeDoc(doc))).toEqual([]);
	});
});
