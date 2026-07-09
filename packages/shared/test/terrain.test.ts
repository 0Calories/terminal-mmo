import { expect, test } from 'bun:test';
import { isSolid, isWall, parseTerrain } from '../src/terrain';

const T = parseTerrain(['....', '#.=.', '....']);

test('parseTerrain maps # to a wall (1) and = to a platform (2)', () => {
	expect(T.cells[1 * T.w + 0]).toBe(1);
	expect(T.cells[1 * T.w + 2]).toBe(2);
	expect(T.cells[1 * T.w + 1]).toBe(0);
});

test('a platform is vertically solid (lands a falling body) but NOT a wall (never blocks horizontal)', () => {
	expect(isSolid(T, 0, 1)).toBe(true);
	expect(isSolid(T, 2, 1)).toBe(true);
	expect(isWall(T, 0, 1)).toBe(true);
	expect(isWall(T, 2, 1)).toBe(false);
});

test('world bounds are walls on both axes (a Player can never leave a Zone sideways)', () => {
	for (const f of [isSolid, isWall]) {
		expect(f(T, -1, 1)).toBe(true);
		expect(f(T, T.w, 1)).toBe(true);
		expect(f(T, 0, T.h)).toBe(true);
	}
	expect(isSolid(T, 0, -1)).toBe(false);
	expect(isWall(T, 0, -1)).toBe(false);
});
