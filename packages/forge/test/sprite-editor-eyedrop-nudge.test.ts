import { describe, expect, test } from 'bun:test';
import {
	colorInk,
	eyedropAt,
	initSpriteEditor,
	moveCursor,
	paintPixel,
	type SpriteEditorState,
	setInk,
	stampGlyph,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

describe('eyedropAt — sample the key, not the RGBA', () => {
	test('a lit Pixel yields its foreground key as the active ink', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 3, 2);
		s = setInk(s, colorInk('m'));
		const picked = eyedropAt(s, 3, 2);
		expect(picked.ink).toEqual(colorInk('g'));
		expect(picked.feedback).toContain("sampled 'g'");
	});

	test('an unlit Pixel of an opaque two-colour cell yields the background key', () => {
		let s = setInk(blankState(), colorInk('p'));
		s = paintPixel(s, 0, 0);
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 1, 1);

		const picked = eyedropAt(s, 1, 0);
		expect(picked.ink).toEqual(colorInk('p'));
	});

	test('a transparent Pixel samples the transparent ink', () => {
		const s = setInk(blankState(), colorInk('g'));
		const picked = eyedropAt(s, 4, 4);
		expect(picked.ink).toEqual(TRANSPARENT_INK);
		expect(picked.feedback).toContain('transparent');
	});

	test('a stamped cell samples the glyph colour key', () => {
		let s = setInk(blankState(), colorInk('y'));
		s = stampGlyph(s, 0, 0, '@');
		s = setInk(s, colorInk('m'));
		const picked = eyedropAt(s, 0, 0);
		expect(picked.ink).toEqual(colorInk('y'));
	});

	test('sampling past the top/left edge reports, and never changes the ink', () => {
		const s = setInk(blankState(), colorInk('g'));
		const picked = eyedropAt(s, -1, 0);
		expect(picked.ink).toEqual(colorInk('g'));
		expect(picked.feedback).toContain('past the canvas edge');
	});

	test('the momentary cursor position drives the one-shot key path', () => {
		let s = setInk(blankState(), colorInk('c'));
		s = paintPixel(s, 5, 1);
		s = setInk(s, colorInk('w'));
		s = moveCursor(s, 5, 1);
		const picked = eyedropAt(s, s.cursor.x, s.cursor.y);
		expect(picked.ink).toEqual(colorInk('c'));
	});
});
