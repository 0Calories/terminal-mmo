import { describe, expect, test } from 'bun:test';
import { type Portal, SPAWN } from '@mmo/core/zones';
import {
	defaultArrival,
	filterCandidates,
	formatArrival,
	parseArrival,
	portalCandidates,
} from '../src/portalForm';

const portal = (x: number, y: number, target: string): Portal => ({
	x,
	y,
	w: 4,
	h: 7,
	target,
	arrival: { x: 0, y: 0 },
});

describe('parseArrival', () => {
	test('parses "x,y" into a coordinate tuple', () => {
		expect(parseArrival('10,12')).toEqual([10, 12]);
	});

	test('tolerates surrounding and inner whitespace', () => {
		expect(parseArrival('  3 , 4 ')).toEqual([3, 4]);
	});

	test('rejects non-numeric, negative, or single values', () => {
		expect(parseArrival('')).toBeUndefined();
		expect(parseArrival('10')).toBeUndefined();
		expect(parseArrival('a,b')).toBeUndefined();
		expect(parseArrival('-1,2')).toBeUndefined();
		expect(parseArrival('1,2,3')).toBeUndefined();
	});
});

describe('portalCandidates', () => {
	test('lists the other Zones (never self), id-sorted, with display names', () => {
		const zones = [
			{ id: 'town-01', name: 'Town Square' },
			{ id: 'field-02' },
			{ id: 'field-01' },
		];
		expect(portalCandidates(zones, 'field-01')).toEqual([
			{ id: 'field-02' },
			{ id: 'town-01', name: 'Town Square' },
		]);
	});
});

describe('filterCandidates', () => {
	const cands = [
		{ id: 'field-01' },
		{ id: 'field-02' },
		{ id: 'town-01', name: 'Town Square' },
	];

	test('empty query returns all candidates unchanged', () => {
		expect(filterCandidates(cands, '')).toEqual(cands);
	});

	test('matches id or name case-insensitively', () => {
		expect(filterCandidates(cands, 'TOWN').map((c) => c.id)).toEqual([
			'town-01',
		]);
		expect(filterCandidates(cands, 'square').map((c) => c.id)).toEqual([
			'town-01',
		]);
	});

	test('ranks prefix matches before inner-substring matches', () => {
		expect(filterCandidates(cands, '01').map((c) => c.id)).toEqual([
			'field-01',
			'town-01',
		]);
		expect(filterCandidates(cands, 'field').map((c) => c.id)).toEqual([
			'field-01',
			'field-02',
		]);
	});
});

describe('defaultArrival', () => {
	test("lands on the target Zone's return-portal cell when one points back", () => {
		const target = {
			portals: [portal(20, 9, 'field-01'), portal(3, 9, 'other')],
		};
		expect(defaultArrival(target, 'field-01')).toEqual([20, 9]);
	});

	test('falls back to the global spawn when no return portal exists', () => {
		const target = { portals: [portal(3, 9, 'other')] };
		expect(defaultArrival(target, 'field-01')).toEqual([SPAWN.x, SPAWN.y]);
	});
});

describe('formatArrival', () => {
	test('renders a tuple as the "x,y" the field round-trips through parseArrival', () => {
		expect(formatArrival([10, 12])).toBe('10,12');
		expect(parseArrival(formatArrival([7, 8]))).toEqual([7, 8]);
	});
});
