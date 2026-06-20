import { expect, test } from 'bun:test';
import { Sprite, spriteFor } from '../src/sprites';

// --- Sprite machinery ------------------------------------------------------

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
	// '/(' -> reverse -> '(/' -> swap -> ')\\'
	const s = new Sprite('\n/(\n', { defaultKey: 'x' });
	expect(s.rows(-1)).toEqual([')\\']);
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

// --- Golden art (pins the live sprite art so accidental edits are caught) ---

const PLAYER = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '];
const CHASER_RIGHT = ['▚ ▟▙ ▞ ', '▟████▙ ', '▞▛▛▛▛▌ ', '▐▟▟▟▟▖ ', '▞    ▚ '];
const CHASER_LEFT = [' ▚ ▟▙ ▞', ' ▟████▙', ' ▐▜▜▜▜▚', ' ▗▙▙▙▙▌', ' ▞    ▚'];

test('player art (Claude buddy) is symmetric: both facings identical', () => {
	const p = spriteFor('player');
	expect(p.w).toBe(9);
	expect(p.h).toBe(3);
	expect(p.rows(1)).toEqual(PLAYER);
	expect(p.rows(-1)).toEqual(PLAYER);
	expect(p.colorKeys(1)[1]).toBe('pppkpkppp'); // two dark eye cells on the body
	expect(p.colorKeys(-1)[1]).toBe('pppkpkppp'); // eyes symmetric under mirror
});

test('chaser art (block maw) mirrors and tints its eye cells green', () => {
	const c = spriteFor('chaser');
	expect(c.rows(1)).toEqual(CHASER_RIGHT);
	expect(c.rows(-1)).toEqual(CHASER_LEFT);
	expect(c.colorKeys(1)[0]).toBe('mmmmmmm');
	expect(c.colorKeys(1)[1]).toBe('mgmmgmm'); // two green eyes on the jaw row
});

test('shooter aliases chaser until it has distinct art (#4)', () => {
	expect(spriteFor('shooter')).toBe(spriteFor('chaser'));
});
