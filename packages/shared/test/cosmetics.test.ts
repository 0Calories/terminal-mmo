import { expect, test } from 'bun:test';
import {
	type Cosmetics,
	clampCosmetics,
	DEFAULT_COSMETICS,
	FORM_COUNT,
	FORMS,
	HAT_COUNT,
	HATS,
	HUE_COUNT,
	HUES,
	NAMEPLATE_COLORS,
	NAMEPLATE_COUNT,
	randomCosmetics,
} from '../src';

test('the default cosmetics are the first slot of every catalog (bareheaded amber)', () => {
	expect(DEFAULT_COSMETICS).toEqual({ hue: 0, hat: 0, nameplate: 0, form: 0 });
	// Catalog index 0 is the unchanged-looking default in each case.
	expect(HATS[0].sprite).toBeNull();
});

test('catalog counts agree with the underlying catalogs', () => {
	expect(HUE_COUNT).toBe(HUES.length);
	expect(HAT_COUNT).toBe(HATS.length);
	expect(NAMEPLATE_COUNT).toBe(NAMEPLATE_COLORS.length);
	expect(FORM_COUNT).toBe(FORMS.length);
});

test('the demo ships the extra Form + hat at ADR 0024 §8 cap (2 Forms, 5 hats)', () => {
	// buddy + 1 new Form = 2 Forms total; the 4 original hats + the bareheaded default +
	// 1 new hat = 6 catalog slots (5 hats). The cap is a TOTAL, not an additive amount
	// (ADR 0024 §"What the demo is", line 120), so these are exact, not lower bounds.
	expect(FORM_COUNT).toBe(2);
	expect(HAT_COUNT).toBe(6);
	// Every hat past the bareheaded default carries real overlay art.
	for (let i = 1; i < HATS.length; i++) expect(HATS[i].sprite).not.toBeNull();
});

test('clampCosmetics passes valid indices through unchanged', () => {
	const c: Cosmetics = { hue: 1, hat: 2, nameplate: 3, form: 0 };
	expect(clampCosmetics(c)).toEqual(c);
});

test('clampCosmetics collapses out-of-range / non-integer indices to the default', () => {
	expect(
		clampCosmetics({ hue: 999, hat: -1, nameplate: 1.5, form: 0 }),
	).toEqual(DEFAULT_COSMETICS);
	expect(
		clampCosmetics({
			hue: Number.NaN,
			hat: HAT_COUNT,
			nameplate: -0.1,
			form: 0,
		}),
	).toEqual(DEFAULT_COSMETICS);
});

test('clampCosmetics defaults an out-of-range form index to 0 (mirrors hue/hat/nameplate)', () => {
	// `form` joins hue/hat/nameplate as a fourth catalog index (ADR 0020); a stray
	// or forward-version value can never produce an out-of-range FORMS lookup.
	const base = { hue: 0, hat: 0, nameplate: 0 };
	expect(clampCosmetics({ ...base, form: FORM_COUNT }).form).toBe(0);
	expect(clampCosmetics({ ...base, form: -1 }).form).toBe(0);
	expect(clampCosmetics({ ...base, form: 1.5 }).form).toBe(0);
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
		expect(c.form).toBeGreaterThanOrEqual(0);
		expect(c.form).toBeLessThan(FORM_COUNT);
	}
});

test('randomCosmetics spreads across the catalogs (not a constant)', () => {
	const hats = new Set<number>();
	const forms = new Set<number>();
	for (let seed = 1; seed <= 50; seed++) {
		hats.add(randomCosmetics(seed).hat);
		forms.add(randomCosmetics(seed).form);
	}
	expect(hats.size).toBeGreaterThan(1);
	// Now that more than one Form ships, a connecting Avatar draws a varied Form too.
	expect(forms.size).toBeGreaterThan(1);
});
