import { expect, test } from 'bun:test';
import {
	type Cosmetics,
	clampCosmetics,
	DEFAULT_COSMETICS,
	HAT_COUNT,
	HATS,
	HUE_COUNT,
	HUES,
	NAMEPLATE_COLORS,
	NAMEPLATE_COUNT,
	randomCosmetics,
} from '../src';

test('the default cosmetics are the first slot of every catalog (bareheaded amber)', () => {
	expect(DEFAULT_COSMETICS).toEqual({ hue: 0, hat: 0, nameplate: 0 });
	// Catalog index 0 is the unchanged-looking default in each case.
	expect(HATS[0].sprite).toBeNull();
});

test('catalog counts agree with the underlying catalogs', () => {
	expect(HUE_COUNT).toBe(HUES.length);
	expect(HAT_COUNT).toBe(HATS.length);
	expect(NAMEPLATE_COUNT).toBe(NAMEPLATE_COLORS.length);
});

test('clampCosmetics passes valid indices through unchanged', () => {
	const c: Cosmetics = { hue: 1, hat: 2, nameplate: 3 };
	expect(clampCosmetics(c)).toEqual(c);
});

test('clampCosmetics collapses out-of-range / non-integer indices to the default', () => {
	expect(clampCosmetics({ hue: 999, hat: -1, nameplate: 1.5 })).toEqual(
		DEFAULT_COSMETICS,
	);
	expect(
		clampCosmetics({ hue: Number.NaN, hat: HAT_COUNT, nameplate: -0.1 }),
	).toEqual(DEFAULT_COSMETICS);
});

test('randomCosmetics is deterministic for a seed and always in range', () => {
	for (let seed = 0; seed < 200; seed++) {
		const c = randomCosmetics(seed);
		expect(c).toEqual(randomCosmetics(seed)); // reproducible
		// Always a valid, clamp-stable catalog index.
		expect(clampCosmetics(c)).toEqual(c);
		expect(c.hue).toBeGreaterThanOrEqual(0);
		expect(c.hue).toBeLessThan(HUE_COUNT);
		expect(c.hat).toBeLessThan(HAT_COUNT);
		expect(c.nameplate).toBeLessThan(NAMEPLATE_COUNT);
	}
});

test('randomCosmetics spreads across the catalogs (not a constant)', () => {
	const hats = new Set<number>();
	for (let seed = 1; seed <= 50; seed++) hats.add(randomCosmetics(seed).hat);
	expect(hats.size).toBeGreaterThan(1);
});
