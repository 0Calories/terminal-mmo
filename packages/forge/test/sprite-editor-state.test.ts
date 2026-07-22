import { describe, expect, test } from 'bun:test';
import { findFrame, parseSpriteFile, quadrantsFromGlyph } from '@mmo/render';
import { trimDoc } from '../src/sprite-editor/resize';
import {
	beginStroke,
	cellAt,
	colorInk,
	defineLocalColor,
	endStroke,
	erasePixel,
	initSpriteEditor,
	paintPixel,
	pixelToCell,
	readPixel,
	redoEdit,
	type SpriteEditorState,
	saveResult,
	selectFrame,
	setInk,
	stampGlyph,
	undoEdit,
} from '../src/sprite-editor/state';
import {
	emptySpriteDoc,
	type SpriteRole,
} from '../src/sprite-editor/templates';

function blankState(role: SpriteRole = 'hat'): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', role));
}

describe('Pixel drawing operations', () => {
	test.each([
		[0, 0, { cellX: 0, cellY: 0, bit: 0 }],
		[1, 0, { cellX: 0, cellY: 0, bit: 1 }],
		[0, 1, { cellX: 0, cellY: 0, bit: 2 }],
		[1, 1, { cellX: 0, cellY: 0, bit: 3 }],
		[3, 5, { cellX: 1, cellY: 2, bit: 3 }],
	] as const)('Pixel (%i,%i) maps to its cell quadrant', (x, y, expected) => {
		expect(pixelToCell(x, y)).toEqual(expected);
	});

	test('a completed stroke draws one document operation and round-trips through undo and redo', () => {
		let state = beginStroke(setInk(blankState(), colorInk('g')));
		state = paintPixel(state, 0, 0);
		state = paintPixel(state, 1, 0);
		state = paintPixel(state, 0, 1);
		state = endStroke(state);

		expect(cellAt(state, 0, 0)).toMatchObject({ glyph: '▛', fg: 'g', bg: '' });
		const authored = state.doc;
		state = undoEdit(state);
		expect(cellAt(state, 0, 0).glyph).toBe(' ');
		state = redoEdit(state);
		expect(state.doc).toEqual(authored);
	});

	test('painting a second color produces the representable fg/background cell', () => {
		let state = paintPixel(setInk(blankState(), colorInk('g')), 0, 0);
		state = paintPixel(setInk(state, colorInk('w')), 1, 1);

		expect(cellAt(state, 0, 0)).toMatchObject({
			glyph: '▗',
			fg: 'w',
			bg: 'g',
			mask: 0b1000,
		});
	});

	test('repainting an occupied Pixel resolves to the new color', () => {
		let state = paintPixel(setInk(blankState(), colorInk('g')), 0, 0);
		state = paintPixel(setInk(state, colorInk('w')), 0, 0);

		expect(cellAt(state, 0, 0)).toMatchObject({
			glyph: '▘',
			fg: 'w',
			bg: '',
			mask: 0b0001,
		});
	});

	test('erasing removes authored Pixels and can empty the cell', () => {
		let state = paintPixel(blankState(), 0, 0);
		state = paintPixel(state, 1, 0);
		state = erasePixel(state, 0, 0);
		expect(cellAt(state, 0, 0)).toMatchObject({ glyph: '▝', mask: 0b0010 });
		state = erasePixel(state, 1, 0);
		expect(cellAt(state, 0, 0)).toMatchObject({ glyph: ' ', mask: 0 });
	});

	test('a Glyph stamp saves as glyph-authored art and a later Pixel replaces it', () => {
		let state = stampGlyph(setInk(blankState(), colorInk('g')), 0, 0, '▲');
		expect(cellAt(state, 0, 0)).toMatchObject({ glyph: '▲', fg: 'g' });
		expect(quadrantsFromGlyph(cellAt(state, 0, 0).glyph)).toBeUndefined();

		state = paintPixel(setInk(state, colorInk('w')), 0, 0);
		expect(cellAt(state, 0, 0)).toMatchObject({ glyph: '▘', fg: 'w' });
	});

	test('drawing is frame-local', () => {
		let state = paintPixel(blankState('form'), 0, 0);
		state = selectFrame(state, 'walk 0');
		expect(readPixel(state, 0, 0)).toBe(false);
		state = paintPixel(state, 2, 0);

		expect(readPixel(selectFrame(state, 'idle'), 0, 0)).toBe(true);
		expect(readPixel(selectFrame(state, 'idle'), 2, 0)).toBe(false);
		expect(readPixel(selectFrame(state, 'walk 0'), 2, 0)).toBe(true);
	});

	test.each([
		[-1, 0],
		[0, -1],
		[12, 0],
		[0, 8],
	] as const)('drawing outside the Frame at (%i,%i) leaves the document unchanged', (x, y) => {
		const before = blankState();
		expect(paintPixel(before, x, y).doc).toBe(before.doc);
	});
});

describe('Sprite color and format laws', () => {
	test('a local color used by authored art survives save and parse', () => {
		let state = defineLocalColor(blankState(), 'z', [10, 20, 30, 255]);
		state = paintPixel(setInk(state, colorInk('z')), 0, 0);
		const parsed = parseSpriteFile(saveResult(state).text, 'test').doc;

		expect(parsed?.colors.z).toEqual([10, 20, 30, 255]);
		if (parsed === null) throw new Error('saved color document did not parse');
		expect(findFrame(parsed, 'idle')?.frame.colors[0]).toContain('z');
	});

	test.each(['p', 'a', 'zz'] as const)('rejects local color key %s', (key) => {
		const before = blankState();
		const after = defineLocalColor(before, key, [0, 0, 0, 255]);
		expect(after.doc).toBe(before.doc);
		expect(after.feedback).not.toBe('');
	});

	test('a completed document with animations, anchors, colors, fg/bg and stamps parses without errors', () => {
		let state = defineLocalColor(blankState('form'), 'z', [10, 20, 30, 255]);
		state = paintPixel(setInk(state, colorInk('z')), 0, 0);
		state = paintPixel(setInk(state, colorInk('g')), 8, 0);
		state = paintPixel(setInk(state, colorInk('w')), 9, 1);
		state = stampGlyph(setInk(state, colorInk('g')), 3, 1, '▲');

		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const parsed = parseSpriteFile(text, 'test');
		expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
			[],
		);
		if (parsed.doc === null)
			throw new Error('saved Sprite document did not parse');

		const actual = findFrame(parsed.doc, 'idle')?.frame;
		const expected = findFrame(trimDoc(state.doc), 'idle')?.frame;
		expect(actual?.rows).toEqual(expected?.rows as string[]);
		expect(actual?.colors).toEqual(expected?.colors as string[]);
		expect(actual?.bg).toEqual(expected?.bg as string[]);
	});

	test.each([
		'form',
		'weapon',
		'hat',
		'monster',
		'npc',
	] as const)('%s authoring template satisfies its format profile', (role) => {
		const { text, diagnostics } = saveResult(blankState(role));
		const parsed = parseSpriteFile(text, 'sample');
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		expect(parsed.doc).not.toBeNull();
		expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
			[],
		);
	});
});
