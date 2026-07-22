import { expect, test } from 'bun:test';
import { parseTerrain, sweepPoint } from '../../src/physics';

const T = parseTerrain([
	'..........',
	'.........#',
	'....====.#',
	'.........#',
	'####.....#',
	'####.....#',
]);

test('clear travel returns null', () => {
	expect(sweepPoint(T, 5.5, 3.2, 6.5, 3.8)).toBeNull();
});

test('descending travel hits the first wall surface crossed', () => {
	const hit = sweepPoint(T, 1.5, 2.5, 1.5, 4.5);
	expect(hit).toEqual({ axis: 'y', cx: 1, cy: 4, x: 1.5, y: 4 });
});

test('descending travel lands on a one-way platform top', () => {
	const hit = sweepPoint(T, 5.5, 0.5, 5.5, 2.5);
	expect(hit).toEqual({ axis: 'y', cx: 5, cy: 2, x: 5.5, y: 2 });
});

test('ascending travel passes through a one-way platform', () => {
	expect(sweepPoint(T, 5.5, 3.5, 5.5, 0.5)).toBeNull();
});

test('ascending travel is blocked by a wall underside (a rising speck cannot embed in a thick solid)', () => {
	const hit = sweepPoint(T, 9.5, 6.5, 9.5, 0.5);
	expect(hit).toEqual({ axis: 'y', cx: 9, cy: 5, x: 9.5, y: 6 });
});

test('rightward travel is blocked by a wall, clipped to its left face', () => {
	const hit = sweepPoint(T, 7.5, 3.5, 9.5, 3.5);
	expect(hit).toEqual({ axis: 'x', cx: 9, cy: 3, x: 9, y: 3.5 });
});

test('leftward travel is blocked by a wall, clipped to its right face', () => {
	const hit = sweepPoint(T, 5.5, 4.5, 2.5, 4.5);
	expect(hit).toEqual({ axis: 'x', cx: 3, cy: 4, x: 4, y: 4.5 });
});

test('sideways travel passes through a one-way platform (horizontally transparent)', () => {
	expect(sweepPoint(T, 2.5, 2.5, 8.5, 2.5)).toBeNull();
});

test('fast descending travel cannot tunnel: the first surface wins, not the destination cell', () => {
	const hit = sweepPoint(T, 5.5, 0.2, 5.5, 3.8);
	expect(hit).toEqual({ axis: 'y', cx: 5, cy: 2, x: 5.5, y: 2 });
});

test('a point resting exactly on a surface re-collides with it (down/right boundary convention)', () => {
	const hit = sweepPoint(T, 1.5, 4, 1.5, 4.1);
	expect(hit?.cy).toBe(4);
});

test('the x leg resolves before the y leg on diagonal travel into a corner', () => {
	const hit = sweepPoint(T, 8.5, 1.5, 9.5, 2.5);
	expect(hit).toEqual({ axis: 'x', cx: 9, cy: 1, x: 9, y: 1.5 });
});
