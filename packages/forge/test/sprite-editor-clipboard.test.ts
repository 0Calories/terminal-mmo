// Clipboard — copy / cut / delete / paste (spec #387, #400). The clipboard is a
// single in-editor buffer that survives Frame/Pose switches; copy is a pure read
// (no undo entry), cut = copy + clear as one step, delete = clear as one step,
// and paste SPAWNS A FLOAT at the source coordinates via the #399 float
// machinery — the paste float then behaves exactly like a move float (drag/
// arrows to place, Enter/drop commits through coercion with clipping, Esc
// cancels), but never punches a hole where the move float lifts its source.
import { describe, expect, test } from 'bun:test';
import {
	cellAt,
	colorInk,
	commitFloat,
	copySelection,
	cutSelection,
	deleteSelection,
	initSpriteEditor,
	nudgeFloat,
	paintPixel,
	pasteFromClipboard,
	readPixel,
	type SpriteEditorState,
	selectFrame,
	setInk,
	setSelection,
	stampGlyph,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

// A single-frame (hat) 6×4-cell (12×8-Pixel) all-transparent canvas.
function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

// A three-frame (form) doc so cross-Frame paste has somewhere to land.
function multiFrame(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'form'));
}

// Two lit Pixels at (0,0),(1,0) with a committed 2×2-Pixel selection over them.
function selected(): SpriteEditorState {
	let s = setInk(blankState(), colorInk('g'));
	s = paintPixel(s, 0, 0);
	s = paintPixel(s, 1, 0);
	return setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
}

// ---------------------------------------------------------------------------
// Copy — a pure read
// ---------------------------------------------------------------------------

describe('copy captures the selection without touching the doc or history', () => {
	test('copy records no undo step and never mutates the doc', () => {
		const s0 = selected();
		const s = copySelection(s0);
		expect(s.doc).toBe(s0.doc); // pure read — same doc object
		expect(s.history.past.length).toBe(s0.history.past.length);
		expect(s.clipboard).not.toBeNull();
		expect(s.clipboard?.pixels).toHaveLength(2);
	});

	test('only lit Pixels are captured — transparent ones never travel', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0); // one lit Pixel in a 2×2 selection
		s = setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
		s = copySelection(s);
		expect(s.clipboard?.pixels).toHaveLength(1);
		expect(s.clipboard?.pixels[0]).toMatchObject({ x: 0, y: 0, key: 'g' });
	});

	test('copy with no selection refuses and leaves the clipboard alone', () => {
		const s = copySelection(blankState());
		expect(s.clipboard ?? null).toBeNull();
		expect(s.feedback).toContain('select');
	});
});

// ---------------------------------------------------------------------------
// Cut — copy + clear as one undo step
// ---------------------------------------------------------------------------

describe('cut copies then clears the selection as exactly one undo step', () => {
	test('cut fills the clipboard, clears the source, keeps the selection', () => {
		const s0 = selected();
		const before = s0.history.past.length;
		const s = cutSelection(s0);
		expect(s.clipboard?.pixels).toHaveLength(2); // copied
		expect(readPixel(s, 0, 0)).toBe(false); // cleared
		expect(readPixel(s, 1, 0)).toBe(false);
		expect(s.history.past.length).toBe(before + 1); // one step
		expect(s.selection).not.toBeNull(); // kept for a follow-up paste
	});

	test('a single undo restores the whole cut at once', () => {
		let s = cutSelection(selected());
		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 1, 0)).toBe(true);
	});

	test('cut with no selection refuses', () => {
		const s = cutSelection(blankState());
		expect(s.feedback).toContain('select');
	});
});

// ---------------------------------------------------------------------------
// Delete — clear as one undo step (reused from #399)
// ---------------------------------------------------------------------------

describe('delete clears the selection contents without touching the clipboard', () => {
	test('delete is one undo step and never fills the clipboard', () => {
		const s0 = selected();
		const before = s0.history.past.length;
		const s = deleteSelection(s0);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(s.history.past.length).toBe(before + 1);
		expect(s.clipboard ?? null).toBeNull(); // delete is not a copy
	});
});

// ---------------------------------------------------------------------------
// The buffer survives Frame / Pose switches
// ---------------------------------------------------------------------------

describe('the clipboard buffer is editor-session-scoped', () => {
	test('a copied buffer survives a Frame switch', () => {
		let s = multiFrame(); // frames idle / walkA / walkB
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 0, y1: 0 });
		s = copySelection(s);
		s = selectFrame(s, 'walkA');
		expect(s.frame).toBe('walkA');
		expect(s.clipboard?.pixels).toHaveLength(1); // still there
	});
});

// ---------------------------------------------------------------------------
// Paste — spawns a float at the source coordinates
// ---------------------------------------------------------------------------

describe('paste spawns a float at the source coordinates', () => {
	test('paste lifts nothing from the canvas — it rides the clipboard content', () => {
		let s = copySelection(selected());
		s = setSelection(s, null); // even with nothing selected, paste works
		s = pasteFromClipboard(s);
		expect(s.float).not.toBeNull();
		expect(s.float?.pixels).toHaveLength(2);
		// The float sits on its source at a zero offset.
		expect(s.float?.source).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
		expect(s.float?.dx).toBe(0);
		expect(s.float?.dy).toBe(0);
	});

	test('an empty clipboard refuses to paste', () => {
		const s = pasteFromClipboard(blankState());
		expect(s.float).toBeNull();
		expect(s.feedback).toContain('empty');
	});

	test('paste then Esc leaves the doc exactly as it was', () => {
		// Cut art out, then paste it back and cancel — the canvas must stay empty.
		let s = cutSelection(selected());
		const doc = s.doc;
		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 4, 2); // drag the paste float somewhere
		s = { ...s, float: null }; // cancelFloat equivalent: drop losslessly
		expect(s.doc).toBe(doc); // no bake happened
	});

	test('dropping the paste float at the source lands the content as one step', () => {
		let s = cutSelection(selected()); // canvas now empty, clipboard holds 2 px
		const before = s.history.past.length;
		s = pasteFromClipboard(s);
		s = commitFloat(s); // zero-offset drop still LANDS a paste (unlike a move)
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 1, 0)).toBe(true);
		expect(s.history.past.length).toBe(before + 1);
		// One undo backs the paste out.
		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(false);
	});

	test('a paste float dragged away never erases the art at its source', () => {
		// Frame already has art at (0,0); paste clipboard content whose source is
		// (0,0) and drag it away. A MOVE would punch a hole at (0,0); a PASTE must
		// not — nothing was lifted from this canvas.
		let s = setInk(blankState(), colorInk('r'));
		s = paintPixel(s, 5, 0); // clipboard source art in cell (2,0)
		s = setSelection(s, { x0: 5, y0: 0, x1: 5, y1: 0 });
		s = copySelection(s);
		// Repaint the source Pixel so the canvas has live art there.
		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 2, 0); // drag the paste float one cell right
		s = commitFloat(s);
		expect(readPixel(s, 5, 0)).toBe(true); // source art untouched by the paste
		expect(readPixel(s, 7, 0)).toBe(true); // pasted copy landed at the offset
	});
});

// ---------------------------------------------------------------------------
// Cross-Frame paste arrives aligned for animation work
// ---------------------------------------------------------------------------

describe('cross-Frame paste arrives at the source coordinates', () => {
	test('copy in one Frame, paste in another, land aligned', () => {
		let s = multiFrame();
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 3, 1);
		s = paintPixel(s, 4, 1);
		s = setSelection(s, { x0: 3, y0: 1, x1: 4, y1: 1 });
		s = copySelection(s);
		s = selectFrame(s, 'walkA'); // a different, empty Frame
		s = pasteFromClipboard(s);
		s = commitFloat(s); // zero-offset drop → lands at the source coords
		expect(readPixel(s, 3, 1)).toBe(true);
		expect(readPixel(s, 4, 1)).toBe(true);
		// The original Frame is untouched.
		s = selectFrame(s, 'idle');
		expect(readPixel(s, 3, 1)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Glyph stamps travel with the clipboard
// ---------------------------------------------------------------------------

describe('Glyph stamps captured by copy travel with the clipboard', () => {
	test('a fully-enclosed stamp is captured and pastes onto the nearest cell', () => {
		let s = stampGlyph(blankState(), 1, 1, '@'); // stamp in cell (1,1)
		s = setSelection(s, { x0: 2, y0: 2, x1: 3, y1: 3 }); // exactly cell (1,1)
		s = copySelection(s);
		expect(s.clipboard?.stamps).toHaveLength(1);
		expect(s.clipboard?.stamps[0]).toMatchObject({
			cellX: 1,
			cellY: 1,
			glyph: '@',
		});
		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 2, 0); // +1 cell right
		s = commitFloat(s);
		expect(cellAt(s, 1, 1).glyph).toBe('@'); // source stamp untouched (paste)
		expect(cellAt(s, 2, 1).glyph).toBe('@'); // pasted copy landed
	});
});
