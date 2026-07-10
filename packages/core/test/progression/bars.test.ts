import { expect, test } from 'bun:test';
import {
	clamp01,
	filledCells,
	fillRatio,
	PROGRESSION,
	xpProgress,
} from '../../src/progression';

test('fillRatio is the clamped fraction, guarding bad maxima', () => {
	expect(fillRatio(50, 100)).toBe(0.5);
	expect(fillRatio(0, 100)).toBe(0);
	expect(fillRatio(100, 100)).toBe(1);
	expect(fillRatio(150, 100)).toBe(1);
	expect(fillRatio(-10, 100)).toBe(0);
	expect(fillRatio(10, 0)).toBe(0);
	expect(fillRatio(10, -5)).toBe(0);
	expect(fillRatio(10, Number.NaN)).toBe(0);
});

test('clamp01 pins to [0,1] and tames non-finite input', () => {
	expect(clamp01(0.25)).toBe(0.25);
	expect(clamp01(-1)).toBe(0);
	expect(clamp01(2)).toBe(1);
	expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
	expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
	expect(clamp01(Number.NaN)).toBe(0);
});

test('filledCells rounds to the nearest cell', () => {
	expect(filledCells(0.5, 10)).toBe(5);
	expect(filledCells(0, 10)).toBe(0);
	expect(filledCells(1, 10)).toBe(10);
	expect(filledCells(0.44, 10)).toBe(4);
	expect(filledCells(0.46, 10)).toBe(5);
	expect(filledCells(2, 10)).toBe(10);
	expect(filledCells(-1, 10)).toBe(0);
	expect(filledCells(0.5, 0)).toBe(0);
});

test('filledCells keeps a pip alive near-empty and a gap open near-full', () => {
	expect(filledCells(0.01, 10)).toBe(1);
	expect(filledCells(0.99, 10)).toBe(9);
	expect(filledCells(0, 10)).toBe(0);
	expect(filledCells(1, 10)).toBe(10);
});

test('xpProgress reports fraction toward the next level at level 1', () => {
	const need = PROGRESSION.xpBase * 1;
	const at = xpProgress(1, 10);
	expect(at.needed).toBe(need);
	expect(at.current).toBe(10);
	expect(at.ratio).toBe(10 / need);
	expect(at.atCap).toBe(false);
});

test('xpProgress clamps banked XP into [0, needed]', () => {
	const over = xpProgress(2, 1_000_000);
	expect(over.needed).toBe(PROGRESSION.xpBase * 2);
	expect(over.current).toBe(over.needed);
	expect(over.ratio).toBe(1);
	const under = xpProgress(2, -5);
	expect(under.current).toBe(0);
	expect(under.ratio).toBe(0);
});

test('xpProgress reads full and maxed at the level cap', () => {
	const capped = xpProgress(PROGRESSION.levelCap, 0);
	expect(capped.atCap).toBe(true);
	expect(capped.needed).toBe(0);
	expect(capped.ratio).toBe(1);
	expect(Number.isFinite(capped.ratio)).toBe(true);
});
