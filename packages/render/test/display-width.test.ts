import { expect, test } from 'bun:test';
import {
	displayColumns,
	segmentGraphemes,
	textColumns,
} from '@mmo/render/sprites';

test('a combining sequence is one grapheme of one column', () => {
	const combined = 'é'; // e + COMBINING ACUTE ACCENT
	const graphemes = segmentGraphemes(combined);
	expect(graphemes).toEqual([combined]);
	expect(displayColumns(combined)).toBe(1);
});

test('a ZWJ emoji sequence stays one grapheme', () => {
	const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // man+ZWJ+woman+ZWJ+girl
	expect(segmentGraphemes(family)).toEqual([family]);
});

test('a CJK character is one two-column grapheme', () => {
	expect(displayColumns('字')).toBe(2);
	expect(segmentGraphemes('字')).toEqual(['字']);
});

test('textColumns sums displayed columns across grapheme clusters', () => {
	// 'A' (1) + '字' (2) + combining 'é' (1) = 4 columns across 3 graphemes.
	const text = 'A字é';
	expect(segmentGraphemes(text)).toEqual(['A', '字', 'é']);
	expect(textColumns(text)).toBe(4);
});
