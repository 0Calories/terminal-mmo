import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	beginFloat,
	cellAt,
	colorInk,
	commitFloat,
	currentFrame,
	deleteSelection,
	frameExtent,
	initSpriteEditor,
	nudgeFloat,
	paintPixel,
	readPixel,
	redoEdit,
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

function selectedArt(): SpriteEditorState {
	let state = paintPixel(setInk(blankState(), colorInk('g')), 0, 0);
	state = paintPixel(state, 1, 0);
	return setSelection(state, { x0: 0, y0: 0, x1: 1, y1: 1 });
}

function selectWithMouse(): SpriteEditorState {
	let state = setTool(blankState(), 'select');
	state = applyInput(
		state,
		normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
	);
	return applyInput(
		state,
		normalizeMouse({ pixel: { x: 3, y: 2 }, button: 'left', phase: 'up' }),
	);
}

function selectWithKeyboard(): SpriteEditorState {
	let state = setTool(blankState(), 'select');
	state = applyInput(
		state,
		normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink', phase: 'toggle' }),
	);
	state = applyInput(
		state,
		normalizeKey({ pixel: { x: 3, y: 2 }, paint: 'none', phase: 'move' }),
	);
	return applyInput(
		state,
		normalizeKey({ pixel: { x: 3, y: 2 }, paint: 'ink', phase: 'toggle' }),
	);
}

describe('completed selection operations', () => {
	test('mouse and keyboard complete the same selection', () => {
		expect(selectWithMouse().selection).toEqual({ x0: 0, y0: 0, x1: 3, y1: 2 });
		expect(selectWithKeyboard().selection).toEqual(selectWithMouse().selection);
	});

	test('moving selected art commits one document transformation with undo and redo', () => {
		let state = setTool(selectedArt(), 'move');
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'up' }),
		);

		expect(readPixel(state, 0, 0)).toBe(false);
		expect(readPixel(state, 2, 0)).toBe(true);
		const moved = state.doc;
		state = undoEdit(state);
		expect(readPixel(state, 0, 0)).toBe(true);
		expect(readPixel(state, 2, 0)).toBe(false);
		expect(redoEdit(state).doc).toEqual(moved);
	});

	test('keyboard nudge and mouse drag commit the same moved document', () => {
		let mouse = setTool(selectedArt(), 'move');
		mouse = applyInput(
			mouse,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		mouse = applyInput(
			mouse,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'up' }),
		);

		let keyboard = beginFloat(setTool(selectedArt(), 'move'), { x: 0, y: 0 });
		keyboard = nudgeFloat(keyboard, 2, 0);
		keyboard = commitFloat(keyboard);
		expect(keyboard.doc).toEqual(mouse.doc);
	});

	test('deleting a selection clears its contents as one undoable operation', () => {
		const deleted = deleteSelection(selectedArt());
		expect(readPixel(deleted, 0, 0)).toBe(false);
		expect(readPixel(deleted, 1, 0)).toBe(false);
		const restored = undoEdit(deleted);
		expect(readPixel(restored, 0, 0)).toBe(true);
		expect(readPixel(restored, 1, 0)).toBe(true);
	});

	test('select-all and nudge move the whole Frame through the same float operation', () => {
		let state = paintPixel(setInk(blankState(), colorInk('g')), 0, 0);
		state = paintPixel(state, 5, 3);
		state = selectAll(state);
		state = nudgeFloat(state, 2, 0);
		state = commitFloat(state);

		expect(readPixel(state, 0, 0)).toBe(false);
		expect(readPixel(state, 2, 0)).toBe(true);
		expect(readPixel(state, 7, 3)).toBe(true);
	});

	test('a move that leaves the Frame clips art without growing the Frame', () => {
		let state = paintPixel(setInk(blankState(), colorInk('g')), 11, 7);
		const extent = frameExtent(currentFrame(state));
		state = setSelection(state, { x0: 11, y0: 7, x1: 11, y1: 7 });
		state = beginFloat(state, { x: 11, y: 7 });
		state = nudgeFloat(state, 2, 0);
		state = commitFloat(state);

		expect(readPixel(state, 11, 7)).toBe(false);
		expect(frameExtent(currentFrame(state))).toEqual(extent);
	});
});

describe('selection content laws', () => {
	test('a fully enclosed Glyph stamp moves with the selection', () => {
		let state = stampGlyph(blankState(), 1, 1, '@');
		state = setSelection(state, { x0: 2, y0: 2, x1: 3, y1: 3 });
		state = beginFloat(state);
		state = nudgeFloat(state, 2, 0);
		state = commitFloat(state);

		expect(cellAt(state, 1, 1).glyph).toBe(' ');
		expect(cellAt(state, 2, 1).glyph).toBe('@');
	});

	test('a partially enclosed Glyph stamp remains in place', () => {
		let state = stampGlyph(blankState(), 1, 1, '@');
		state = setSelection(state, { x0: 2, y0: 2, x1: 2, y1: 2 });
		state = beginFloat(state);
		state = nudgeFloat(state, 2, 0);
		state = commitFloat(state);
		expect(cellAt(state, 1, 1).glyph).toBe('@');
	});

	test('transparent space in a selection never erases destination art', () => {
		let state = paintPixel(setInk(blankState(), colorInk('g')), 0, 0);
		state = paintPixel(setInk(state, colorInk('r')), 2, 2);
		state = setSelection(state, { x0: 0, y0: 0, x1: 3, y1: 1 });
		state = beginFloat(state);
		state = nudgeFloat(state, 0, 2);
		state = commitFloat(state);

		expect(cellAt(state, 0, 1).fg).toBe('g');
		expect(cellAt(state, 1, 1).fg).toBe('r');
	});
});
