import { expect, test } from 'bun:test';
import { Sprite } from '../src';

test('parses art: trims template blank lines, maps sentinel, computes dims', () => {
	const s = new Sprite('\n·A·\nBBB\n', { defaultKey: 'x' });
	expect(s.w).toBe(3);
	expect(s.h).toBe(2);
	expect(s.rows(1)).toEqual([' A ', 'BBB']);
});

test('right-pads ragged rows to the max width', () => {
	const s = new Sprite('\n·A·\nBB\n', { defaultKey: 'x' });
	expect(s.w).toBe(3);
	expect(s.rows(1)).toEqual([' A ', 'BB ']);
});

test('mirrors glyphs: reverse + swap mirror-pairs', () => {
	const s = new Sprite('\n/(\n', { defaultKey: 'x' });
	expect(s.rows(-1)).toEqual([')\\']);
});

test('mirrors block-element glyphs by reflecting their lit quadrants', () => {
	const s = new Sprite('\n▌▖▛\n', { defaultKey: 'x' });
	expect(s.rows(-1)).toEqual(['▜▗▐']);
});

test('mono-colour sprite: every cell is the default key', () => {
	const s = new Sprite('\nAB\nC\n', { defaultKey: 'p' });
	expect(s.colorKeys(1)).toEqual(['pp', 'pp']);
});

test('colour grid: sentinel/space fall back to default key, explicit keys kept', () => {
	const s = new Sprite('\nAB\n', { colors: '·e\n', defaultKey: 'p' });
	expect(s.colorKeys(1)).toEqual(['pe']);
});

test('colour grid mirrors positionally (reverse only, no key swap)', () => {
	const s = new Sprite('\nAB\n', { colors: 'pe\n', defaultKey: 'x' });
	expect(s.colorKeys(-1)).toEqual(['ep']);
});

test('throws when colour grid dimensions do not match the glyph grid', () => {
	expect(
		() => new Sprite('\nABC\n', { colors: 'pp\n', defaultKey: 'x' }),
	).toThrow();
});

test('throws when defaultKey is not a single char', () => {
	expect(() => new Sprite('\nA\n', { defaultKey: 'player' })).toThrow();
});

test('baseline defaults to 0 and preserves an explicit value', () => {
	expect(new Sprite('\nA\n', { defaultKey: 'x' }).baseline).toBe(0);
	expect(new Sprite('\nA\n', { defaultKey: 'x', baseline: 1 }).baseline).toBe(
		1,
	);
});

test('without a background grid, bgKeys match the sprite with transparent cells', () => {
	const s = new Sprite('\nAB\nCD\n', { defaultKey: 'x' });
	expect(s.bgKeys(1)).toEqual(['  ', '  ']);
	expect(s.bgKeys(-1)).toEqual(['  ', '  ']);
});

test('bg grid: explicit keys kept on inked cells, sentinel/space map to space', () => {
	const s = new Sprite('\nAB\n', { bg: '·b\n', defaultKey: 'p' });
	expect(s.bgKeys(1)).toEqual([' b']);
});

test('bg grid mirrors positionally (reverse only, no key swap)', () => {
	const s = new Sprite('\nAB\n', { bg: 'ab\n', defaultKey: 'x' });
	expect(s.bgKeys(-1)).toEqual(['ba']);
});

test('throws when bg grid dimensions do not match the glyph grid', () => {
	expect(
		() => new Sprite('\nABC\n', { bg: 'bb\n', defaultKey: 'x' }),
	).toThrow();
});

test('throws when bg key sits on a transparent glyph cell, naming coordinates', () => {
	expect(() => new Sprite('\n·A\n', { bg: 'bb\n', defaultKey: 'x' })).toThrow(
		/\(0,0\)/,
	);
});

test('two-color cell: colors and bg channels coexist independently', () => {
	const s = new Sprite('\nAB\n', {
		colors: 'pe\n',
		bg: '·b\n',
		defaultKey: 'x',
	});
	expect(s.colorKeys(1)).toEqual(['pe']);
	expect(s.bgKeys(1)).toEqual([' b']);
});
