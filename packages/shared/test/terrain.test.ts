import { expect, test } from 'bun:test';
import { isSolid, isWall, parseTerrain } from '../src/terrain';

// A wall (`#`) and a one-way platform (`=`) side by side (ADR 0026).
const T = parseTerrain([
	'....',
	'#.=.', // wall at (0,1), platform at (2,1)
	'....',
]);

test('parseTerrain maps # to a wall (1) and = to a platform (2)', () => {
	expect(T.cells[1 * T.w + 0]).toBe(1); // #
	expect(T.cells[1 * T.w + 2]).toBe(2); // =
	expect(T.cells[1 * T.w + 1]).toBe(0); // .
});

test('a platform is vertically solid (lands a falling body) but NOT a wall (never blocks horizontal)', () => {
	// isSolid governs vertical landing — both wall and platform stop a descending body.
	expect(isSolid(T, 0, 1)).toBe(true); // wall
	expect(isSolid(T, 2, 1)).toBe(true); // platform
	// isWall governs horizontal collision — only the wall blocks; the platform is
	// transparent, so a body rising through it keeps its sideways velocity.
	expect(isWall(T, 0, 1)).toBe(true); // wall blocks
	expect(isWall(T, 2, 1)).toBe(false); // platform does not
});

test('world bounds are walls on both axes (a Player can never leave a Zone sideways)', () => {
	for (const f of [isSolid, isWall]) {
		expect(f(T, -1, 1)).toBe(true); // left of the world
		expect(f(T, T.w, 1)).toBe(true); // right of the world
		expect(f(T, 0, T.h)).toBe(true); // below the world
	}
	// Open sky above the world is empty on both axes.
	expect(isSolid(T, 0, -1)).toBe(false);
	expect(isWall(T, 0, -1)).toBe(false);
});
