import { expect, test } from 'bun:test';
import {
	clamp01,
	filledCells,
	fillRatio,
	PROGRESSION,
	xpProgress,
} from '../src';

test('fillRatio is the clamped fraction, guarding bad maxima', () => {
	expect(fillRatio(50, 100)).toBe(0.5);
	expect(fillRatio(0, 100)).toBe(0);
	expect(fillRatio(100, 100)).toBe(1);
	// Overheal / overflow never spills past a full bar.
	expect(fillRatio(150, 100)).toBe(1);
	// Negative current (a dead Avatar mid-frame) reads empty, never negative.
	expect(fillRatio(-10, 100)).toBe(0);
	// A zero / negative / non-finite max can't divide-by-zero into the renderer.
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
	// Ratio is clamped before it counts cells.
	expect(filledCells(2, 10)).toBe(10);
	expect(filledCells(-1, 10)).toBe(0);
	// A zero-width bar lights nothing (no crash).
	expect(filledCells(0.5, 0)).toBe(0);
});

test('filledCells keeps a pip alive near-empty and a gap open near-full', () => {
	// "Almost dead" still shows one lit pip rather than rounding to a blank bar.
	expect(filledCells(0.01, 10)).toBe(1);
	// "Almost full" still shows one empty gap rather than rounding to a maxed bar.
	expect(filledCells(0.99, 10)).toBe(9);
	// Exact extremes are honest: truly empty and truly full.
	expect(filledCells(0, 10)).toBe(0);
	expect(filledCells(1, 10)).toBe(10);
});

test('xpProgress reports fraction toward the next level at level 1', () => {
	const need = PROGRESSION.xpBase * 1; // 40 to reach level 2
	const at = xpProgress(1, 10);
	expect(at.needed).toBe(need);
	expect(at.current).toBe(10);
	expect(at.ratio).toBe(10 / need);
	expect(at.atCap).toBe(false);
});

test('xpProgress clamps banked XP into [0, needed]', () => {
	// XP should never exceed the threshold in practice, but the bar stays honest if it does.
	const over = xpProgress(2, 1_000_000);
	expect(over.needed).toBe(PROGRESSION.xpBase * 2);
	expect(over.current).toBe(over.needed);
	expect(over.ratio).toBe(1);
	// Negative XP reads as an empty bar.
	const under = xpProgress(2, -5);
	expect(under.current).toBe(0);
	expect(under.ratio).toBe(0);
});

test('xpProgress reads full and maxed at the level cap', () => {
	// At the cap there is no next level: the bar is full, needed is 0, atCap is set — and
	// no divide-by-Infinity leaks a NaN ratio.
	const capped = xpProgress(PROGRESSION.levelCap, 0);
	expect(capped.atCap).toBe(true);
	expect(capped.needed).toBe(0);
	expect(capped.ratio).toBe(1);
	expect(Number.isFinite(capped.ratio)).toBe(true);
});
