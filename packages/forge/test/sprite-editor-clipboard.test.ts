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

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

function multiFrame(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'form'));
}

function selected(): SpriteEditorState {
	let s = setInk(blankState(), colorInk('g'));
	s = paintPixel(s, 0, 0);
	s = paintPixel(s, 1, 0);
	return setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
}

describe('copy captures the selection without touching the doc or history', () => {
	test('copy records no undo step and never mutates the doc', () => {
		const s0 = selected();
		const s = copySelection(s0);
		expect(s.doc).toBe(s0.doc);
		expect(s.history.past.length).toBe(s0.history.past.length);
		expect(s.clipboard).not.toBeNull();
		expect(s.clipboard?.pixels).toHaveLength(2);
	});

	test('only lit Pixels are captured — transparent ones never travel', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
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

describe('cut copies then clears the selection as exactly one undo step', () => {
	test('cut fills the clipboard, clears the source, keeps the selection', () => {
		const s0 = selected();
		const before = s0.history.past.length;
		const s = cutSelection(s0);
		expect(s.clipboard?.pixels).toHaveLength(2);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 1, 0)).toBe(false);
		expect(s.history.past.length).toBe(before + 1);
		expect(s.selection).not.toBeNull();
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

describe('delete clears the selection contents without touching the clipboard', () => {
	test('delete is one undo step and never fills the clipboard', () => {
		const s0 = selected();
		const before = s0.history.past.length;
		const s = deleteSelection(s0);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(s.history.past.length).toBe(before + 1);
		expect(s.clipboard ?? null).toBeNull();
	});
});

describe('the clipboard buffer is editor-session-scoped', () => {
	test('a copied buffer survives a Frame switch', () => {
		let s = multiFrame();
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 0, y1: 0 });
		s = copySelection(s);
		s = selectFrame(s, 'walk 0');
		expect(s.frame).toBe('walk 0');
		expect(s.clipboard?.pixels).toHaveLength(1);
	});
});

describe('paste spawns a float at the source coordinates', () => {
	test('paste lifts nothing from the canvas — it rides the clipboard content', () => {
		let s = copySelection(selected());
		s = setSelection(s, null);
		s = pasteFromClipboard(s);
		expect(s.float).not.toBeNull();
		expect(s.float?.pixels).toHaveLength(2);

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
		let s = cutSelection(selected());
		const doc = s.doc;
		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 4, 2);
		s = { ...s, float: null };
		expect(s.doc).toBe(doc);
	});

	test('dropping the paste float at the source lands the content as one step', () => {
		let s = cutSelection(selected());
		const before = s.history.past.length;
		s = pasteFromClipboard(s);
		s = commitFloat(s);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 1, 0)).toBe(true);
		expect(s.history.past.length).toBe(before + 1);

		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(false);
	});

	test('a paste float dragged away never erases the art at its source', () => {
		let s = setInk(blankState(), colorInk('r'));
		s = paintPixel(s, 5, 0);
		s = setSelection(s, { x0: 5, y0: 0, x1: 5, y1: 0 });
		s = copySelection(s);

		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 2, 0);
		s = commitFloat(s);
		expect(readPixel(s, 5, 0)).toBe(true);
		expect(readPixel(s, 7, 0)).toBe(true);
	});
});

describe('cross-Frame paste arrives at the source coordinates', () => {
	test('copy in one Frame, paste in another, land aligned', () => {
		let s = multiFrame();
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 3, 1);
		s = paintPixel(s, 4, 1);
		s = setSelection(s, { x0: 3, y0: 1, x1: 4, y1: 1 });
		s = copySelection(s);
		s = selectFrame(s, 'walk 0');
		s = pasteFromClipboard(s);
		s = commitFloat(s);
		expect(readPixel(s, 3, 1)).toBe(true);
		expect(readPixel(s, 4, 1)).toBe(true);

		s = selectFrame(s, 'idle');
		expect(readPixel(s, 3, 1)).toBe(true);
	});
});

describe('Glyph stamps captured by copy travel with the clipboard', () => {
	test('a fully-enclosed stamp is captured and pastes onto the nearest cell', () => {
		let s = stampGlyph(blankState(), 1, 1, '@');
		s = setSelection(s, { x0: 2, y0: 2, x1: 3, y1: 3 });
		s = copySelection(s);
		expect(s.clipboard?.stamps).toHaveLength(1);
		expect(s.clipboard?.stamps[0]).toMatchObject({
			cellX: 1,
			cellY: 1,
			glyph: '@',
		});
		s = pasteFromClipboard(s);
		s = nudgeFloat(s, 2, 0);
		s = commitFloat(s);
		expect(cellAt(s, 1, 1).glyph).toBe('@');
		expect(cellAt(s, 2, 1).glyph).toBe('@');
	});
});
