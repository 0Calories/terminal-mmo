import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core';
import { parseSpriteFile, quadrantsFromGlyph } from '@mmo/render';
import {
	beginStroke,
	cellAt,
	clearCell,
	currentFrame,
	defineLocalColor,
	endStroke,
	erasePixel,
	frameExtent,
	initSpriteEditor,
	moveCursor,
	paintPixel,
	paletteEntries,
	pixelToCell,
	readPixel,
	redoEdit,
	type SpriteEditorState,
	saveResult,
	selectFrame,
	setBgKey,
	setFgKey,
	setTool,
	stampGlyph,
	undoEdit,
} from '../src/sprite-editor/state';
import {
	emptySpriteDoc,
	type SpriteRole,
} from '../src/sprite-editor/templates';

// A roomy, all-transparent single-frame doc for pixel tests.
function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

const PREVIEWS = {
	p: [255, 150, 40, 255] as const,
	a: [120, 200, 255, 255] as const,
};

describe('pixelToCell', () => {
	test('maps sub-pixels to the documented bit layout', () => {
		// bit0=TL, bit1=TR, bit2=BL, bit3=BR within a 2×2 cell.
		expect(pixelToCell(0, 0)).toEqual({ cellX: 0, cellY: 0, bit: 0 });
		expect(pixelToCell(1, 0)).toEqual({ cellX: 0, cellY: 0, bit: 1 });
		expect(pixelToCell(0, 1)).toEqual({ cellX: 0, cellY: 0, bit: 2 });
		expect(pixelToCell(1, 1)).toEqual({ cellX: 0, cellY: 0, bit: 3 });
		// Cell (1,0) begins at pixel x=2.
		expect(pixelToCell(2, 0)).toEqual({ cellX: 1, cellY: 0, bit: 0 });
		expect(pixelToCell(3, 5)).toEqual({ cellX: 1, cellY: 2, bit: 3 });
	});
});

describe('paintPixel — the one-color path', () => {
	test('painting an empty cell lights one fg quadrant, transparent bg', () => {
		const s = paintPixel(blankState(), 0, 0);
		expect(s.feedback).toBe('');
		const cell = cellAt(s, 0, 0);
		expect(cell.glyph).toBe('▘'); // mask 1 = TL
		expect(cell.fg).toBe('p'); // default key
		expect(cell.bg).toBe(''); // transparent
		expect(readPixel(s, 0, 0)).toBe(true);
	});

	test('painting the same fg extends the mask', () => {
		let s = paintPixel(blankState(), 0, 0); // TL
		s = paintPixel(s, 1, 0); // TR
		const cell = cellAt(s, 0, 0);
		expect(cell.mask).toBe(0b0011); // TL|TR
		expect(cell.glyph).toBe('▀');
		expect(cell.bg).toBe('');
	});

	test('filling all four quadrants yields the full block, still one color', () => {
		let s = blankState();
		for (const [px, py] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		])
			s = paintPixel(s, px, py);
		const cell = cellAt(s, 0, 0);
		expect(cell.glyph).toBe('█');
		expect(cell.mask).toBe(15);
		expect(cell.bg).toBe('');
	});

	test('a second, different fg color in the same cell is refused (never two fg)', () => {
		let s = paintPixel(blankState(), 0, 0); // fg 'p'
		s = setFgKey(s, 'g');
		const before = s.doc;
		s = paintPixel(s, 1, 0);
		expect(s.doc).toBe(before); // unchanged
		expect(s.feedback).toContain("already uses color 'p'");
	});

	test('painting an already-lit pixel with the same color is a no-op (no history)', () => {
		const s0 = paintPixel(blankState(), 0, 0);
		const s1 = paintPixel(s0, 0, 0);
		expect(s1.doc).toBe(s0.doc);
		expect(s1.history.past.length).toBe(s0.history.past.length);
		expect(s1.feedback).toBe('');
	});
});

describe('paintPixel — the two-color (fg + bg) path', () => {
	test('a bg selection fills the complement, producing a fully-opaque two-color cell', () => {
		let s = setFgKey(blankState(), 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 0, 0); // one fg quadrant + bg fills the other three
		const cell = cellAt(s, 0, 0);
		expect(cell.mask).toBe(0b0001);
		expect(cell.fg).toBe('g');
		expect(cell.bg).toBe('w');
		expect(cell.glyph).toBe('▘');
	});

	test('extending the fg into the bg complement keeps it opaque and two-color', () => {
		let s = setFgKey(blankState(), 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 0, 0); // fg TL, bg elsewhere
		s = setBgKey(s, null); // keep drawing fg, no bg change
		s = paintPixel(s, 1, 0); // fg TR
		const cell = cellAt(s, 0, 0);
		expect(cell.mask).toBe(0b0011);
		expect(cell.fg).toBe('g');
		expect(cell.bg).toBe('w'); // bg preserved
	});

	test('filling the last complement pixel demotes to one opaque color (bg dropped)', () => {
		let s = setFgKey(blankState(), 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 0, 0);
		s = setFgKey(s, 'g');
		s = setBgKey(s, null);
		for (const [px, py] of [
			[1, 0],
			[0, 1],
			[1, 1],
		])
			s = paintPixel(s, px, py);
		const cell = cellAt(s, 0, 0);
		expect(cell.mask).toBe(15);
		expect(cell.bg).toBe(''); // no complement, bg is invisible → dropped
	});

	test('painting a different fg over a two-color cell is refused (no third color)', () => {
		let s = setFgKey(blankState(), 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 0, 0);
		s = setFgKey(s, 'm');
		const before = s.doc;
		s = paintPixel(s, 1, 0);
		expect(s.doc).toBe(before);
		expect(s.feedback).toContain("already uses color 'g'");
	});
});

describe('erasePixel', () => {
	test('removing a sub-pixel from a one-color cell leaves a transparent hole', () => {
		let s = paintPixel(blankState(), 0, 0);
		s = paintPixel(s, 1, 0); // ▀ (TL|TR)
		s = erasePixel(s, 0, 0); // remove TL
		const cell = cellAt(s, 0, 0);
		expect(cell.mask).toBe(0b0010); // TR only
		expect(cell.glyph).toBe('▝');
		expect(cell.bg).toBe('');
	});

	test('erasing the last lit pixel empties the cell to the sentinel', () => {
		let s = paintPixel(blankState(), 0, 0);
		s = erasePixel(s, 0, 0);
		const cell = cellAt(s, 0, 0);
		expect(cell.glyph).toBe(' ');
		expect(cell.mask).toBe(0);
		expect(cell.fg).toBe('');
	});

	test('erasing a pixel of a two-color cell is refused — clear the cell first', () => {
		let s = setFgKey(blankState(), 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 0, 0);
		const before = s.doc;
		s = erasePixel(s, 0, 0);
		expect(s.doc).toBe(before);
		expect(s.feedback).toContain('background color');
	});

	test('erasing empty space is a silent no-op', () => {
		const s0 = blankState();
		const s1 = erasePixel(s0, 0, 0);
		expect(s1.doc).toBe(s0.doc);
		expect(s1.feedback).toBe('');
	});
});

describe('glyph stamp + immunity', () => {
	test('stampGlyph places an arbitrary character with the selected fg', () => {
		let s = setFgKey(blankState(), 'g');
		s = stampGlyph(s, 0, 0, '▲');
		const cell = cellAt(s, 0, 0);
		expect(cell.glyph).toBe('▲');
		expect(cell.fg).toBe('g');
		expect(quadrantsFromGlyph(cell.glyph)).toBeUndefined();
		expect(cell.mask).toBeUndefined();
	});

	test('a stamped cell is immune to paintPixel until cleared', () => {
		let s = stampGlyph(blankState(), 0, 0, '▲');
		const before = s.doc;
		s = paintPixel(s, 0, 0);
		expect(s.doc).toBe(before);
		expect(s.feedback).toContain("stamped glyph '▲'");
	});

	test('a stamped cell is immune to erasePixel until cleared', () => {
		let s = stampGlyph(blankState(), 0, 0, '╱');
		const before = s.doc;
		s = erasePixel(s, 0, 0);
		expect(s.doc).toBe(before);
		expect(s.feedback).toContain("stamped glyph '╱'");
	});

	test('clearCell empties a stamped cell so pixels work again', () => {
		let s = stampGlyph(blankState(), 0, 0, '▲');
		s = clearCell(s, 0, 0);
		expect(cellAt(s, 0, 0).glyph).toBe(' ');
		s = paintPixel(s, 0, 0);
		expect(s.feedback).toBe('');
		expect(cellAt(s, 0, 0).glyph).toBe('▘');
	});

	test('stamping a space or sentinel is refused', () => {
		expect(stampGlyph(blankState(), 0, 0, ' ').feedback).toContain('clearCell');
		expect(stampGlyph(blankState(), 0, 0, '·').feedback).toContain('clearCell');
	});
});

describe('auto-grow', () => {
	test('painting outside the extent grows all grids, padded with sentinel', () => {
		const s0 = blankState();
		const ext0 = frameExtent(currentFrame(s0));
		// Cell (10, 6) begins at pixel (20, 12) — well outside 6×4.
		const s = paintPixel(s0, 20, 12);
		const frame = currentFrame(s);
		const ext = frameExtent(frame);
		expect(ext.w).toBe(11);
		expect(ext.h).toBe(7);
		expect(ext.w).toBeGreaterThan(ext0.w);
		// Every grid row is padded to the new width, and untouched cells are blank.
		for (const grid of [frame.rows, frame.colors, frame.bg])
			for (const row of grid) expect(row.length).toBe(11);
		expect(cellAt(s, 0, 0).glyph).toBe(' ');
		expect(cellAt(s, 10, 6).glyph).toBe('▘');
	});

	test('painting at negative pixel coordinates is refused', () => {
		const s0 = blankState();
		const s = paintPixel(s0, -1, 0);
		expect(s.doc).toBe(s0.doc);
		expect(s.feedback).toContain('outside the canvas');
	});
});

describe('color selection & local colors', () => {
	test('setFgKey / setBgKey update selection; bg none clears it', () => {
		let s = setFgKey(blankState(), 'g');
		expect(s.fgKey).toBe('g');
		s = setBgKey(s, 'w');
		expect(s.bgKey).toBe('w');
		s = setBgKey(s, null);
		expect(s.bgKey).toBeNull();
	});

	test('defineLocalColor adds a file-local color to the doc', () => {
		const s = defineLocalColor(blankState(), 'z', [10, 20, 30, 255]);
		expect(s.feedback).toBe('');
		expect(s.doc.colors.z).toEqual([10, 20, 30, 255]);
	});

	test('defineLocalColor refuses the reserved dynamic keys p and a', () => {
		expect(
			defineLocalColor(blankState(), 'p', [0, 0, 0, 255]).feedback,
		).toContain('reserved');
		expect(
			defineLocalColor(blankState(), 'a', [0, 0, 0, 255]).feedback,
		).toContain('reserved');
	});

	test('defineLocalColor refuses multi-character keys', () => {
		expect(
			defineLocalColor(blankState(), 'zz', [0, 0, 0, 255]).feedback,
		).toContain('single character');
	});

	test('paletteEntries lists local, then global (minus reserved), then the two dynamic channels', () => {
		const s = defineLocalColor(blankState(), 'z', [10, 20, 30, 255]);
		const entries = paletteEntries(s, SCENE_PALETTE, PREVIEWS);
		expect(entries[0]).toEqual({
			key: 'z',
			rgba: [10, 20, 30, 255],
			label: 'z',
			kind: 'local',
		});
		// No reserved keys appear in the 'palette' group.
		const palette = entries.filter((e) => e.kind === 'palette');
		expect(palette.some((e) => e.key === 'p' || e.key === 'a')).toBe(false);
		expect(palette.some((e) => e.key === 'g')).toBe(true);
		// The two dynamic channels are labeled by meaning, with injected previews.
		const dyn = entries.filter((e) => e.kind === 'dynamic');
		expect(dyn).toEqual([
			{ key: 'p', rgba: PREVIEWS.p, label: 'player hue', kind: 'dynamic' },
			{ key: 'a', rgba: PREVIEWS.a, label: 'weapon accent', kind: 'dynamic' },
		]);
	});
});

describe('undo / redo', () => {
	test('each non-stroke paint is its own undo step', () => {
		let s = paintPixel(blankState(), 0, 0);
		s = paintPixel(s, 2, 0); // different cell
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 2, 0)).toBe(true);
		s = undoEdit(s);
		expect(readPixel(s, 2, 0)).toBe(false);
		expect(readPixel(s, 0, 0)).toBe(true);
		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(false);
	});

	test('a stroke coalesces contiguous paints into one undo step', () => {
		let s = beginStroke(blankState());
		s = paintPixel(s, 0, 0);
		s = paintPixel(s, 1, 0);
		s = paintPixel(s, 0, 1);
		s = endStroke(s);
		expect(cellAt(s, 0, 0).mask).toBe(0b0111);
		const undone = undoEdit(s);
		// One undo removes the whole stroke.
		expect(cellAt(undone, 0, 0).mask).toBe(0);
	});

	test('two strokes are two undo steps', () => {
		let s = beginStroke(blankState());
		s = paintPixel(s, 0, 0);
		s = endStroke(s);
		s = beginStroke(s);
		s = paintPixel(s, 2, 0);
		s = endStroke(s);
		s = undoEdit(s); // undoes the second stroke only
		expect(readPixel(s, 2, 0)).toBe(false);
		expect(readPixel(s, 0, 0)).toBe(true);
	});

	test('redo restores an undone edit exactly', () => {
		let s = paintPixel(blankState(), 0, 0);
		const painted = s.doc;
		s = undoEdit(s);
		s = redoEdit(s);
		expect(s.doc).toEqual(painted);
	});

	test('refused ops create no history entry', () => {
		let s = stampGlyph(blankState(), 0, 0, '▲');
		const depth = s.history.past.length;
		s = paintPixel(s, 0, 0); // refused (immune)
		expect(s.history.past.length).toBe(depth);
	});
});

describe('selectFrame & cursor', () => {
	test('selectFrame switches frames; unknown frame refused', () => {
		const doc = emptySpriteDoc('hero', 'form');
		let s = initSpriteEditor(doc);
		expect(s.frame).toBe('idle');
		s = selectFrame(s, 'walkA');
		expect(s.frame).toBe('walkA');
		const before = s;
		s = selectFrame(s, 'nope');
		expect(s.frame).toBe('walkA');
		expect(s.feedback).toContain('no such frame');
		expect(before.doc).toBe(s.doc);
	});

	test('painting affects only the current frame', () => {
		let s = initSpriteEditor(emptySpriteDoc('hero', 'form'));
		s = paintPixel(s, 0, 0); // in idle
		s = selectFrame(s, 'walkA');
		expect(readPixel(s, 0, 0)).toBe(false); // walkA untouched
	});

	test('moveCursor clamps to non-negative pixels', () => {
		let s = moveCursor(blankState(), 5, 3);
		expect(s.cursor).toEqual({ x: 5, y: 3 });
		s = moveCursor(s, -2, -9);
		expect(s.cursor).toEqual({ x: 0, y: 0 });
	});

	test('setTool switches the active tool', () => {
		const s = setTool(blankState(), 'stamp');
		expect(s.tool).toBe('stamp');
	});
});

describe('saveResult round-trip', () => {
	test('serializes a doc exercising poses, anchors, colors and bg with no error diagnostics', () => {
		let s = initSpriteEditor(emptySpriteDoc('hero', 'form'));
		s = defineLocalColor(s, 'z', [10, 20, 30, 255]);
		// One-color pixel with a local fg.
		s = setFgKey(s, 'z');
		s = paintPixel(s, 0, 0);
		// A two-color (fg+bg) cell.
		s = setFgKey(s, 'g');
		s = setBgKey(s, 'w');
		s = paintPixel(s, 4, 0);
		// A glyph stamp.
		s = setBgKey(s, null);
		s = stampGlyph(s, 3, 1, '▲');

		const { text, diagnostics } = saveResult(s);
		const errors = diagnostics.filter((d) => d.severity === 'error');
		expect(errors).toEqual([]);
		// Round-trips: re-parsing yields the same frame art.
		const { doc } = parseSpriteFile(text, 'hero');
		expect(doc).not.toBeNull();
		const idle = doc?.frames.find((f) => f.name === 'idle');
		const editedIdle = currentFrameByName(s, 'idle');
		expect(idle?.rows).toEqual(editedIdle.rows);
		expect(idle?.colors).toEqual(editedIdle.colors);
		expect(idle?.bg).toEqual(editedIdle.bg);
	});
});

function currentFrameByName(s: SpriteEditorState, name: string) {
	const f = s.doc.frames.find((fr) => fr.name === name);
	if (!f) throw new Error(`no frame ${name}`);
	return f;
}

describe('role templates', () => {
	const roles: SpriteRole[] = ['form', 'weapon', 'hat', 'monster', 'npc'];
	test.each(roles)('%s template parses cleanly', (role) => {
		const doc = emptySpriteDoc('sample', role);
		const { text } = saveResult(initSpriteEditor(doc));
		const { doc: parsed, diagnostics } = parseSpriteFile(text, 'sample');
		expect(parsed).not.toBeNull();
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	});

	test('form has idle/walkA/walkB frames and grip/head anchors', () => {
		const doc = emptySpriteDoc('hero', 'form');
		expect(doc.frames.map((f) => f.name)).toEqual(['idle', 'walkA', 'walkB']);
		expect(Object.keys(doc.anchors).sort()).toEqual(['grip', 'head']);
	});

	test('weapon has idle/windup/active frames and a grip anchor', () => {
		const doc = emptySpriteDoc('sword', 'weapon');
		expect(doc.frames.map((f) => f.name)).toEqual(['idle', 'windup', 'active']);
		expect(Object.keys(doc.anchors)).toEqual(['grip']);
	});

	test('hat / monster / npc have a single idle frame', () => {
		for (const role of ['hat', 'monster', 'npc'] as SpriteRole[]) {
			const doc = emptySpriteDoc('x', role);
			expect(doc.frames.map((f) => f.name)).toEqual(['idle']);
		}
	});
});
