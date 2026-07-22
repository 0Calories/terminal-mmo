import { describe, expect, test } from 'bun:test';
import {
	clamp01,
	filledCells,
	fillRatio,
	PROGRESSION,
	xpProgress,
} from '../../src/progression';

describe('bar ratio laws', () => {
	for (const [name, value, expected] of [
		['interior', 0.25, 0.25],
		['below zero', -1, 0],
		['above one', 2, 1],
		['positive infinity', Number.POSITIVE_INFINITY, 1],
		['negative infinity', Number.NEGATIVE_INFINITY, 0],
		['NaN', Number.NaN, 0],
	] as const) {
		test(`clamp01 handles ${name}`, () =>
			expect(clamp01(value)).toBe(expected));
	}

	for (const [current, maximum, expected] of [
		[50, 100, 0.5],
		[0, 100, 0],
		[100, 100, 1],
		[150, 100, 1],
		[-10, 100, 0],
		[10, 0, 0],
		[10, -5, 0],
		[10, Number.NaN, 0],
	] as const) {
		test(`fillRatio(${current}, ${maximum}) = ${expected}`, () => {
			expect(fillRatio(current, maximum)).toBe(expected);
		});
	}
});

test('filledCells rounds interior values while preserving empty/full endpoints', () => {
	for (const [ratio, width, expected] of [
		[0, 10, 0],
		[1, 10, 10],
		[0.01, 10, 1],
		[0.99, 10, 9],
		[0.44, 10, 4],
		[0.46, 10, 5],
		[2, 10, 10],
		[-1, 10, 0],
		[0.5, 0, 0],
	] as const)
		expect(filledCells(ratio, width)).toBe(expected);
});

describe('XP bar laws', () => {
	test('progress is derived from the configured next-level threshold', () => {
		const level = Math.min(2, PROGRESSION.levelCap - 1);
		const needed = PROGRESSION.xpBase * level;
		const progress = xpProgress(level, needed / 4);
		expect(progress).toEqual({
			current: needed / 4,
			needed,
			ratio: 0.25,
			atCap: false,
		});
	});

	test('banked XP clamps into the current rung', () => {
		const level = Math.min(2, PROGRESSION.levelCap - 1);
		const needed = PROGRESSION.xpBase * level;
		expect(xpProgress(level, Number.MAX_SAFE_INTEGER)).toMatchObject({
			current: needed,
			ratio: 1,
		});
		expect(xpProgress(level, -1)).toMatchObject({ current: 0, ratio: 0 });
	});

	test('the configured cap reports a finite full bar with no next threshold', () => {
		expect(xpProgress(PROGRESSION.levelCap, 0)).toEqual({
			current: 0,
			needed: 0,
			ratio: 1,
			atCap: true,
		});
	});
});
