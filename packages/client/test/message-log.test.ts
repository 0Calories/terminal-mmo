import { expect, test } from 'bun:test';
import { isStyledText } from '@opentui/core';
import { appendedTail, styleLogLine } from '../src/message-log';

// --- appendedTail: incremental append against a bounded, append-then-evict buffer ---

test('appendedTail returns all of a fresh buffer on the first sync', () => {
	expect(appendedTail([], ['a', 'b'])).toEqual(['a', 'b']);
});

test('appendedTail returns only the newly-appended tail', () => {
	expect(appendedTail(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
});

test('appendedTail returns nothing when the buffer is unchanged', () => {
	expect(appendedTail(['a', 'b'], ['a', 'b'])).toEqual([]);
});

test('appendedTail handles front eviction (append past the cap)', () => {
	// The window shifted forward by one and gained a new tail line.
	expect(appendedTail(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['d']);
});

test('appendedTail treats a fully-rotated window as all new', () => {
	// No overlap at all: every current line is new (worst case, never a dropped line).
	expect(appendedTail(['a', 'b'], ['x', 'y'])).toEqual(['x', 'y']);
});

test('appendedTail chooses the largest overlap so duplicate lines are not re-appended', () => {
	// A repeated line must not desync the diff into re-emitting history.
	expect(appendedTail(['hi', 'hi'], ['hi', 'hi', 'hi'])).toEqual(['hi']);
});

// --- styleLogLine: rarity-coloured pickup line, plain otherwise (#272) ---

test('styleLogLine leaves a non-loot line as a plain string', () => {
	expect(styleLogLine('Entered the Dungeon.')).toBe('Entered the Dungeon.');
	expect(styleLogLine('Sold rare Iron Sword (+8g).')).toBe(
		'Sold rare Iron Sword (+8g).',
	);
});

test('styleLogLine colours a Looted line as styled text for each rarity', () => {
	for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary']) {
		const styled = styleLogLine(`Looted ${rarity} Iron Sword.`);
		expect(isStyledText(styled)).toBe(true);
		if (isStyledText(styled)) {
			// The whole line survives across the chunks: framing words + tinted label.
			const text = styled.chunks.map((c) => c.text).join('');
			expect(text).toBe(`Looted ${rarity} Iron Sword.`);
		}
	}
});
