import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	cellAt,
	colorInk,
	currentFrame,
	floodFill,
	frameExtent,
	initSpriteEditor,
	paintPixel,
	readPixel,
	redoEdit,
	type SpriteEditorState,
	setInk,
	setTool,
	stampGlyph,
	TRANSPARENT_INK,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

describe('completed fill operations', () => {
	test('a fill colors the connected displayed region, respects a color boundary, and stays Frame-bounded', () => {
		let state = setInk(blankState(), colorInk('g'));
		for (const [x, y] of [
			[4, 2],
			[5, 2],
			[4, 3],
			[5, 3],
		] as const)
			state = paintPixel(state, x, y);
		const before = frameExtent(currentFrame(state));
		state = floodFill(state, 0, 0, colorInk('w'));

		expect(cellAt(state, 0, 0).fg).toBe('w');
		expect(cellAt(state, 5, 3).fg).toBe('w');
		expect(cellAt(state, 2, 1)).toMatchObject({ glyph: '█', fg: 'g' });
		expect(frameExtent(currentFrame(state))).toEqual(before);
	});

	test('fill follows the displayed color within a two-color cell', () => {
		let state = paintPixel(blankState(), 0, 0);
		state = paintPixel(setInk(state, colorInk('g')), 1, 1);
		state = floodFill(state, 1, 1, colorInk('w'));

		expect(cellAt(state, 0, 0)).toMatchObject({
			fg: 'w',
			bg: 'p',
			mask: 0b1000,
		});
		expect(readPixel(state, 4, 4)).toBe(false);
	});

	test('Glyph stamps bound color fills and survive the completed operation', () => {
		let state = stampGlyph(blankState(), 2, 1, '▲');
		state = floodFill(state, 0, 0, colorInk('w'));

		expect(cellAt(state, 2, 1).glyph).toBe('▲');
		expect(cellAt(state, 0, 0).fg).toBe('w');
		expect(cellAt(state, 5, 3).fg).toBe('w');
	});

	test('transparent fill clears a connected region and its embedded stamps', () => {
		let state = floodFill(blankState(), 0, 0, colorInk('p'));
		state = stampGlyph(state, 2, 1, '▲');
		state = floodFill(state, 0, 0, TRANSPARENT_INK);

		expect(readPixel(state, 0, 0)).toBe(false);
		expect(readPixel(state, 11, 7)).toBe(false);
		expect(cellAt(state, 2, 1).glyph).toBe(' ');
	});

	test('one undo and redo traverse the entire fill', () => {
		const filled = floodFill(blankState(), 0, 0, colorInk('p'));
		const authored = filled.doc;
		const undone = undoEdit(filled);
		expect(readPixel(undone, 0, 0)).toBe(false);
		expect(readPixel(undone, 11, 7)).toBe(false);
		expect(redoEdit(undone).doc).toEqual(authored);
	});

	test('mouse and keyboard complete the same fill document', () => {
		const start = setInk(setTool(blankState(), 'fill'), colorInk('g'));
		const mouse = applyInput(
			start,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		const keyboard = applyInput(
			start,
			normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink' }),
		);
		expect(mouse.doc).toEqual(keyboard.doc);
	});
});

describe('fill boundaries', () => {
	test('filling beyond the Frame changes nothing', () => {
		const before = blankState();
		expect(floodFill(before, 99, 99, colorInk('p')).doc).toBe(before.doc);
	});

	test('repeating a fill with the displayed color changes nothing', () => {
		const filled = floodFill(blankState(), 0, 0, colorInk('p'));
		expect(floodFill(filled, 0, 0, colorInk('p')).doc).toBe(filled.doc);
	});

	test('a transparent fill seeded on one stamp clears only that stamp', () => {
		let state = stampGlyph(blankState(), 2, 1, '▲');
		state = stampGlyph(state, 0, 0, '●');
		state = floodFill(state, 4, 2, TRANSPARENT_INK);
		expect(cellAt(state, 2, 1).glyph).toBe(' ');
		expect(cellAt(state, 0, 0).glyph).toBe('●');
	});
});
