import { expect, test } from 'bun:test';
import { CHAT_MAX_LEN } from '@mmo/core/protocol';
import { BUBBLE_COLS, bubbleTtl, layoutBubble } from '../src/ui/bubble';

test('bubbleTtl scales with length, clamped to [3, 7] seconds', () => {
	expect(bubbleTtl(0)).toBe(3);
	expect(bubbleTtl(20)).toBe(3);
	expect(bubbleTtl(60)).toBe(5);
	expect(bubbleTtl(CHAT_MAX_LEN)).toBe(7);
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

test('a full-length message wraps to a bounded number of lines', () => {
	const lines = layoutBubble('a'.repeat(CHAT_MAX_LEN), BUBBLE_COLS);
	expect(lines.length).toBeLessThanOrEqual(6);
});
