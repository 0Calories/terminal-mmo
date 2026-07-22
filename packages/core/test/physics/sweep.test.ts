import { expect, test } from 'bun:test';
import { parseTerrain, sweepPoint } from '../../src/physics';

const terrain = parseTerrain([
	'..........',
	'.........#',
	'....====.#',
	'.........#',
	'####.....#',
	'####.....#',
]);

const cases = [
	{
		name: 'clear travel',
		from: [5.5, 3.2],
		to: [6.5, 3.8],
		hit: null,
	},
	{
		name: 'descent to a wall top',
		from: [1.5, 2.5],
		to: [1.5, 4.5],
		hit: { axis: 'y', cx: 1, cy: 4, x: 1.5, y: 4 },
	},
	{
		name: 'descent to a one-way platform top',
		from: [5.5, 0.5],
		to: [5.5, 2.5],
		hit: { axis: 'y', cx: 5, cy: 2, x: 5.5, y: 2 },
	},
	{
		name: 'ascent through a one-way platform',
		from: [5.5, 3.5],
		to: [5.5, 0.5],
		hit: null,
	},
	{
		name: 'ascent to a wall underside',
		from: [9.5, 6.5],
		to: [9.5, 0.5],
		hit: { axis: 'y', cx: 9, cy: 5, x: 9.5, y: 6 },
	},
	{
		name: 'rightward travel to a wall',
		from: [7.5, 3.5],
		to: [9.5, 3.5],
		hit: { axis: 'x', cx: 9, cy: 3, x: 9, y: 3.5 },
	},
	{
		name: 'leftward travel to a wall',
		from: [5.5, 4.5],
		to: [2.5, 4.5],
		hit: { axis: 'x', cx: 3, cy: 4, x: 4, y: 4.5 },
	},
	{
		name: 'sideways travel through a one-way platform',
		from: [2.5, 2.5],
		to: [8.5, 2.5],
		hit: null,
	},
	{
		name: 'fast descent at its first crossed surface',
		from: [5.5, 0.2],
		to: [5.5, 3.8],
		hit: { axis: 'y', cx: 5, cy: 2, x: 5.5, y: 2 },
	},
	{
		name: 'diagonal travel with x resolved before y',
		from: [8.5, 1.5],
		to: [9.5, 2.5],
		hit: { axis: 'x', cx: 9, cy: 1, x: 9, y: 1.5 },
	},
] as const;

for (const { name, from, to, hit } of cases) {
	test(name, () => {
		expect(sweepPoint(terrain, from[0], from[1], to[0], to[1])).toEqual(hit);
	});
}

test('a point resting on a surface follows the down/right boundary convention', () => {
	expect(sweepPoint(terrain, 1.5, 4, 1.5, 4.1)?.cy).toBe(4);
});
