import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	beginFloat,
	cancelFloat,
	cellAt,
	colorInk,
	commitFloat,
	currentFrame,
	deleteSelection,
	floatDisplayDoc,
	frameExtent,
	initSpriteEditor,
	makeSelection,
	nudgeFloat,
	paintPixel,
	readPixel,
	type SpriteEditorState,
	selectAll,
	setInk,
	setSelection,
	setTool,
	stampGlyph,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

function displayed(s: SpriteEditorState): SpriteEditorState {
	return { ...s, doc: floatDisplayDoc(s) };
}

describe('floating move — lift, drop, one undo step', () => {
	function selected(): SpriteEditorState {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = paintPixel(s, 1, 0);
		return setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
	}

	test('lifting captures the selected art without touching history', () => {
		const s0 = selected();
		const s = beginFloat(s0, { x: 0, y: 0 });
		expect(s.float).not.toBeNull();
		expect(s.float?.pixels).toHaveLength(2);
		expect(s.history.past.length).toBe(s0.history.past.length);

		const d = displayed(s);
		expect(readPixel(d, 0, 0)).toBe(true);
		expect(readPixel(d, 1, 0)).toBe(true);
	});

	test('a nudge floats the art live — source transparent, float at the offset', () => {
		let s = beginFloat(selected(), { x: 0, y: 0 });
		s = nudgeFloat(s, 2, 0);
		const d = displayed(s);
		expect(readPixel(d, 0, 0)).toBe(false);
		expect(readPixel(d, 1, 0)).toBe(false);
		expect(readPixel(d, 2, 0)).toBe(true);
		expect(readPixel(d, 3, 0)).toBe(true);
	});

	test('the drop commits lift+drop as exactly one undo step', () => {
		let s = beginFloat(selected(), { x: 0, y: 0 });
		s = nudgeFloat(s, 2, 0);
		const before = s.history.past.length;
		s = commitFloat(s);
		expect(s.float).toBeNull();
		expect(s.history.past.length).toBe(before + 1);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 2, 0)).toBe(true);

		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 2, 0)).toBe(false);
	});

	test('the drop resolves through the standard coercion rules', () => {
		let s = setInk(blankState(), colorInk('r'));
		s = paintPixel(s, 4, 0);
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 0, y1: 0 });
		s = beginFloat(s, { x: 0, y: 0 });
		s = nudgeFloat(s, 5, 0);
		s = commitFloat(s);

		expect(cellAt(s, 2, 0).fg).toBe('g');
		expect(cellAt(s, 2, 0).bg).toBe('r');
	});

	test('Esc cancels losslessly — the art returns exactly as it was', () => {
		const s0 = selected();
		let s = beginFloat(s0, { x: 0, y: 0 });
		s = nudgeFloat(s, 3, 2);
		s = cancelFloat(s);
		expect(s.float).toBeNull();
		expect(s.doc).toBe(s0.doc);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 1, 0)).toBe(true);
	});

	test('the live display composite equals what the drop commits', () => {
		let s = beginFloat(selected(), { x: 0, y: 0 });
		s = nudgeFloat(s, 4, 2);
		const preview = displayed(s);
		const committed = commitFloat(s);
		for (let y = 0; y < 8; y++)
			for (let x = 0; x < 12; x++)
				expect(readPixel(committed, x, y)).toBe(readPixel(preview, x, y));
	});
});

describe('transparent float Pixels skip on landing', () => {
	test('only lit Pixels are lifted — transparent ones are never queued', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
		s = beginFloat(s);
		expect(s.float?.pixels).toHaveLength(1);
		expect(s.float?.pixels[0]).toMatchObject({ x: 0, y: 0, key: 'g' });
	});

	test('a transparent float Pixel never erases the art underneath it', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setInk(s, colorInk('r'));
		s = paintPixel(s, 2, 2);
		s = setSelection(s, { x0: 0, y0: 0, x1: 3, y1: 1 });
		s = beginFloat(s);
		s = nudgeFloat(s, 0, 2);
		s = commitFloat(s);
		expect(readPixel(s, 0, 2)).toBe(true);
		expect(cellAt(s, 0, 1).fg).toBe('g');

		expect(readPixel(s, 2, 2)).toBe(true);
		expect(cellAt(s, 1, 1).fg).toBe('r');
	});
});

describe('Glyph stamps travel only when fully enclosed', () => {
	test('a fully-enclosed stamp travels and lands on the nearest cell', () => {
		let s = stampGlyph(blankState(), 1, 1, '@');
		s = setSelection(s, { x0: 2, y0: 2, x1: 3, y1: 3 });
		s = beginFloat(s);
		expect(s.float?.stamps).toHaveLength(1);
		expect(s.float?.stamps[0]).toMatchObject({
			cellX: 1,
			cellY: 1,
			glyph: '@',
		});
		s = nudgeFloat(s, 2, 0);
		s = commitFloat(s);
		expect(cellAt(s, 1, 1).glyph).toBe(' ');
		expect(cellAt(s, 2, 1).glyph).toBe('@');
	});

	test('a partially-covered stamp stays put', () => {
		let s = stampGlyph(blankState(), 1, 1, '@');
		s = setSelection(s, { x0: 2, y0: 2, x1: 2, y1: 2 });
		s = beginFloat(s);
		expect(s.float?.stamps).toHaveLength(0);
		s = nudgeFloat(s, 2, 0);
		s = commitFloat(s);
		expect(cellAt(s, 1, 1).glyph).toBe('@');
	});
});

describe('out-of-bounds drops clip with feedback', () => {
	test('a Pixel dropped past the edge clips and never grows the canvas', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 11, 7);
		const ext0 = frameExtent(currentFrame(s));
		s = setSelection(s, { x0: 11, y0: 7, x1: 11, y1: 7 });
		s = beginFloat(s, { x: 11, y: 7 });
		s = nudgeFloat(s, 2, 0);
		s = commitFloat(s);
		expect(s.feedback).toContain('clipped');
		expect(frameExtent(currentFrame(s))).toEqual(ext0);
	});
});

describe('delete clears the selection contents as one undo step', () => {
	test('the selected Pixels are cleared and the selection survives', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = paintPixel(s, 1, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
		const before = s.history.past.length;
		s = deleteSelection(s);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 1, 0)).toBe(false);
		expect(s.history.past.length).toBe(before + 1);
		expect(s.selection).not.toBeNull();
	});
});

describe('whole-Frame shift = select-all + float', () => {
	test('select-all covers the whole Frame in Pixels', () => {
		const s = selectAll(blankState());
		expect(s.selection).toEqual({ x0: 0, y0: 0, x1: 11, y1: 7 });
	});

	test('a nudge over a select-all floats the whole Frame with no new machinery', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = paintPixel(s, 5, 3);
		s = selectAll(s);
		s = nudgeFloat(s, 2, 0);
		expect(s.float).not.toBeNull();
		const d = displayed(s);
		expect(readPixel(d, 0, 0)).toBe(false);
		expect(readPixel(d, 2, 0)).toBe(true);
		expect(readPixel(d, 7, 3)).toBe(true);
	});
});

describe('select marquee — anchor gesture, device parity', () => {
	function viaMouse(): SpriteEditorState {
		let s = setTool(blankState(), 'select');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 2 }, button: 'left', phase: 'drag' }),
		);
		return applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 2 }, button: 'left', phase: 'up' }),
		);
	}

	function viaKey(): SpriteEditorState {
		let s = setTool(blankState(), 'select');
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink', phase: 'toggle' }),
		);
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 3, y: 2 }, paint: 'none', phase: 'move' }),
		);
		return applyInput(
			s,
			normalizeKey({ pixel: { x: 3, y: 2 }, paint: 'ink', phase: 'toggle' }),
		);
	}

	test('a mouse drag commits the selection rectangle', () => {
		const s = viaMouse();
		expect(s.shape).toBeNull();
		expect(s.selection).toEqual(
			makeSelection(s, { x: 0, y: 0 }, { x: 3, y: 2 }),
		);
	});

	test('both devices commit the same selection over the same shared state', () => {
		expect(viaKey().selection).toEqual(viaMouse().selection);
	});

	test('the marquee is pending (live preview) before the release commits', () => {
		let s = setTool(blankState(), 'select');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 2 }, button: 'left', phase: 'drag' }),
		);
		expect(s.shape?.tool).toBe('select');
		expect(s.selection).toBeNull();
	});
});

describe('move float — mouse drag reaches the same art as a keyboard nudge', () => {
	function setup(): SpriteEditorState {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 0, 0);
		s = setSelection(s, { x0: 0, y0: 0, x1: 1, y1: 1 });
		return setTool(s, 'move');
	}

	test('a mouse grab-drag-drop lifts, moves, and commits the float', () => {
		let s = setup();
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		expect(s.float).not.toBeNull();
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'drag' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'up' }),
		);
		expect(s.float).toBeNull();
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 2, 0)).toBe(true);
	});

	test('the drag path and the nudge path land the same committed doc', () => {
		let mouse = setup();
		mouse = applyInput(
			mouse,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		mouse = applyInput(
			mouse,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'up' }),
		);

		let kb = setup();
		kb = beginFloat(kb, { x: 0, y: 0 });
		kb = nudgeFloat(kb, 2, 0);
		kb = commitFloat(kb);

		expect(mouse.doc).toEqual(kb.doc);
	});

	test('a grab outside the selection lifts nothing', () => {
		let s = setup();
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 8, y: 6 }, button: 'left', phase: 'down' }),
		);
		expect(s.float).toBeNull();
	});
});
