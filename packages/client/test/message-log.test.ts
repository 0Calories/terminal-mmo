import { expect, test } from 'bun:test';
import { isStyledText } from '@opentui/core';
import { appendedTail, styleLogLine } from '../src/ui/message-log';

test.each([
	[[], ['a', 'b'], ['a', 'b']],
	[['a', 'b'], ['a', 'b', 'c'], ['c']],
	[['a', 'b'], ['a', 'b'], []],
	[['a', 'b', 'c'], ['b', 'c', 'd'], ['d']],
	[
		['a', 'b'],
		['x', 'y'],
		['x', 'y'],
	],
	[['hi', 'hi'], ['hi', 'hi', 'hi'], ['hi']],
] as const)('appendedTail returns only content not already presented', (seen, next, expected) => {
	expect(appendedTail([...seen], [...next])).toEqual([...expected]);
});

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
			const text = styled.chunks.map((c) => c.text).join('');
			expect(text).toBe(`Looted ${rarity} Iron Sword.`);
		}
	}
});
