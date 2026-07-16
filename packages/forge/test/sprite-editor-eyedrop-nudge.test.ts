// Pure state seam (spec #397): the eyedropper samples the colour KEY at a
// Pixel, and `;`/`'` nudge the active ink along the rail order. Asserted as
// state → action → next ink + feedback, never internal representation.
import { describe, expect, test } from 'bun:test';
import { STANDARD_PALETTE } from '@mmo/core/entities';
import {
	colorInk,
	eyedropAt,
	initSpriteEditor,
	inkLabel,
	moveCursor,
	nudgeInk,
	paintPixel,
	paletteEntries,
	type SpriteEditorState,
	setInk,
	stampGlyph,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SPRITE_PREVIEWS } from '../src/sprite-editor/view';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

function entriesFor(state: SpriteEditorState) {
	return paletteEntries(state, STANDARD_PALETTE, SPRITE_PREVIEWS);
}

describe('eyedropAt — sample the key, not the RGBA (spec #397)', () => {
	test('a lit Pixel yields its foreground key as the active ink', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = paintPixel(s, 3, 2); // light a 'g' Pixel
		s = setInk(s, colorInk('m')); // active ink now differs
		const picked = eyedropAt(s, 3, 2);
		expect(picked.ink).toEqual(colorInk('g'));
		expect(picked.feedback).toContain("sampled 'g'");
	});

	test('an unlit Pixel of an opaque two-colour cell yields the background key', () => {
		// Build an opaque cell: paint 'p' at TL, then overpaint 'g' elsewhere in the
		// same cell so the old fg 'p' demotes to the background.
		let s = setInk(blankState(), colorInk('p'));
		s = paintPixel(s, 0, 0); // 'p' at TL of cell (0,0)
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 1, 1); // overpaint → cell opaque, bg 'p', fg 'g'
		// Sample an unlit Pixel of that cell (TR is unlit here): it shows the bg 'p'.
		const picked = eyedropAt(s, 1, 0);
		expect(picked.ink).toEqual(colorInk('p'));
	});

	test('a transparent Pixel samples the transparent ink', () => {
		const s = setInk(blankState(), colorInk('g'));
		const picked = eyedropAt(s, 4, 4); // nothing painted here
		expect(picked.ink).toEqual(TRANSPARENT_INK);
		expect(picked.feedback).toContain('transparent');
	});

	test('a stamped cell samples the glyph colour key', () => {
		let s = setInk(blankState(), colorInk('y'));
		s = stampGlyph(s, 0, 0, '@'); // a '@' stamp coloured 'y'
		s = setInk(s, colorInk('m'));
		const picked = eyedropAt(s, 0, 0); // any Pixel of the stamped cell
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

describe('nudgeInk — step to the adjacent rail swatch (spec #397)', () => {
	test('steps forward and back through the rail order', () => {
		const s = blankState();
		const entries = entriesFor(s);
		const first = colorInk(entries[0].key);
		const fromFirst = nudgeInk(setInk(s, first), entries, 1);
		expect(fromFirst.ink).toEqual(colorInk(entries[1].key));
		const back = nudgeInk(fromFirst, entries, -1);
		expect(back.ink).toEqual(first);
	});

	test('transparent is the last swatch — forward from it wraps to the first', () => {
		const s = setInk(blankState(), TRANSPARENT_INK);
		const entries = entriesFor(s);
		const wrapped = nudgeInk(s, entries, 1);
		expect(wrapped.ink).toEqual(colorInk(entries[0].key));
	});

	test('stepping back from the first swatch wraps to transparent', () => {
		const s = blankState();
		const entries = entriesFor(s);
		const at0 = setInk(s, colorInk(entries[0].key));
		const wrapped = nudgeInk(at0, entries, -1);
		expect(inkLabel(wrapped.ink)).toBe('transparent');
	});

	test('an ink not in the rail nudges from the start rather than dead-ending', () => {
		const s = setInk(blankState(), colorInk('§')); // not a rail swatch
		const entries = entriesFor(s);
		const nudged = nudgeInk(s, entries, 1);
		expect(nudged.ink).toEqual(colorInk(entries[1].key));
	});
});
