import { expect, test } from 'bun:test';
import { CHAT_MAX_LEN } from '@mmo/core/protocol';
import { BUBBLE_COLS, bubbleTtl, layoutBubble } from '../src/ui/bubble';

test('bubbleTtl scales with Chat text length and clamps at both ends', () => {
	const shortest = bubbleTtl(0);
	const medium = bubbleTtl(Math.floor(CHAT_MAX_LEN / 2));
	const longest = bubbleTtl(CHAT_MAX_LEN);
	expect(shortest).toBeLessThanOrEqual(medium);
	expect(medium).toBeLessThanOrEqual(longest);
	expect(bubbleTtl(-1)).toBe(shortest);
	expect(bubbleTtl(CHAT_MAX_LEN * 2)).toBe(longest);
});

test('layoutBubble word-wraps within the column width', () => {
	const lines = layoutBubble('the quick brown fox jumps', 10);
	for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
	expect(lines.join(' ')).toBe('the quick brown fox jumps');
});

test('layoutBubble hard-splits a word longer than the line', () => {
	const lines = layoutBubble('supercalifragilistic', 8);
	for (const line of lines) expect(line.length).toBeLessThanOrEqual(8);
	expect(lines.join('')).toBe('supercalifragilistic');
});

test('layoutBubble always returns at least one line', () => {
	expect(layoutBubble('', 22)).toEqual(['']);
});

test('a full-length Chat line wraps to a bounded number of lines', () => {
	const lines = layoutBubble('a'.repeat(CHAT_MAX_LEN), BUBBLE_COLS);
	expect(lines.length).toBeLessThanOrEqual(
		Math.ceil(CHAT_MAX_LEN / BUBBLE_COLS),
	);
});

test('layoutBubble wraps wide graphemes by displayed columns, not string length', () => {
	// Six CJK graphemes = 12 displayed columns; at maxCols 6 they wrap to two lines
	// of three graphemes (six columns each), never one 6-character line.
	const lines = layoutBubble('字'.repeat(6), 6);
	expect(lines.length).toBe(2);
	for (const line of lines) expect([...line].length).toBe(3);
});

test('layoutBubble never splits a two-column grapheme across the boundary', () => {
	// maxCols 3 admits one wide grapheme (2 cols) per line; the grapheme stays whole.
	const lines = layoutBubble('字字字', 3);
	for (const line of lines) expect([...line]).toEqual(['字']);
	expect(lines.length).toBe(3);
});
