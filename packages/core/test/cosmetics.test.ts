import { expect, test } from 'bun:test';
import {
	type Cosmetics,
	clampCosmetics,
	DEFAULT_COSMETICS,
	FORM_COUNT,
	HUE_COUNT,
	HUES,
	LEGACY_HAT_IDS,
	NAMEPLATE_COLORS,
	NAMEPLATE_COUNT,
	randomCosmetics,
	sanitizeHatId,
} from '../src';

test('the default cosmetics are the first slot of every catalog (bareheaded amber)', () => {
	expect(DEFAULT_COSMETICS).toEqual({ hue: 0, hat: '', nameplate: 0, form: 0 });
});

test('catalog counts agree with the underlying catalogs', () => {
	expect(HUE_COUNT).toBe(HUES.length);
	expect(NAMEPLATE_COUNT).toBe(NAMEPLATE_COLORS.length);
});

test('the demo ships a single shippable Form (hats are now scanned sprite ids)', () => {
	expect(FORM_COUNT).toBe(1);
});

test('clampCosmetics passes valid indices + a string hat through unchanged', () => {
	const c: Cosmetics = { hue: 1, hat: 'top-hat', nameplate: 3, form: 0 };
	expect(clampCosmetics(c)).toEqual(c);
});

test('clampCosmetics collapses out-of-range / non-integer indices to the default', () => {
	expect(
		clampCosmetics({ hue: 999, hat: '', nameplate: 1.5, form: 0 }),
	).toEqual(DEFAULT_COSMETICS);
	expect(
		clampCosmetics({
			hue: Number.NaN,
			hat: '',
			nameplate: -0.1,
			form: 0,
		}),
	).toEqual(DEFAULT_COSMETICS);
});

test('clampCosmetics collapses a non-string hat to the empty (no-hat) id', () => {
	const c = {
		hue: 0,
		hat: 250 as unknown as string,
		nameplate: 0,
		form: 0,
	} as Cosmetics;
	expect(clampCosmetics(c).hat).toBe('');
});

test('clampCosmetics defaults an out-of-range form index to 0 (mirrors hue/nameplate)', () => {
	const base = { hue: 0, hat: '', nameplate: 0 };
	expect(clampCosmetics({ ...base, form: FORM_COUNT }).form).toBe(0);
	expect(clampCosmetics({ ...base, form: -1 }).form).toBe(0);
	expect(clampCosmetics({ ...base, form: 1.5 }).form).toBe(0);
});

test('sanitizeHatId passes through an id in the valid set', () => {
	const valid = new Set(['cap', 'crown']);
	expect(sanitizeHatId('cap', valid)).toBe('cap');
});

test('sanitizeHatId falls back to the empty id for a dangling / unknown id', () => {
	const valid = new Set(['cap', 'crown']);
	expect(sanitizeHatId('top-hat', valid)).toBe('');
	expect(sanitizeHatId('None', valid)).toBe('');
});

test('sanitizeHatId falls back to the empty id for a non-string value', () => {
	const valid = new Set(['cap']);
	expect(sanitizeHatId(1, valid)).toBe('');
	expect(sanitizeHatId(undefined, valid)).toBe('');
	expect(sanitizeHatId(null, valid)).toBe('');
});

test('randomCosmetics is deterministic for a seed and always in range', () => {
	const hatIds = ['cap', 'crown', 'wizard'];
	for (let seed = 0; seed < 200; seed++) {
		const c = randomCosmetics(seed, hatIds);
		expect(c).toEqual(randomCosmetics(seed, hatIds));
		expect(clampCosmetics(c)).toEqual(c);
		expect(c.hue).toBeGreaterThanOrEqual(0);
		expect(c.hue).toBeLessThan(HUE_COUNT);
		expect(['', ...hatIds]).toContain(c.hat);
		expect(c.nameplate).toBeLessThan(NAMEPLATE_COUNT);
		expect(c.form).toBeGreaterThanOrEqual(0);
		expect(c.form).toBeLessThan(FORM_COUNT);
	}
});

test('randomCosmetics spreads across the catalogs (not a constant)', () => {
	const hatIds = ['cap', 'crown', 'wizard'];
	const hats = new Set<string>();
	const forms = new Set<number>();
	for (let seed = 1; seed <= 50; seed++) {
		hats.add(randomCosmetics(seed, hatIds).hat);
		forms.add(randomCosmetics(seed, hatIds).form);
	}
	expect(hats.size).toBeGreaterThan(1);
	// only one Form ships, so every roll lands on it
	expect(forms.size).toBe(1);
	expect(forms.has(0)).toBe(true);
});

test('randomCosmetics with no hat pool always draws the no-hat id', () => {
	for (let seed = 0; seed < 20; seed++) {
		expect(randomCosmetics(seed).hat).toBe('');
		expect(randomCosmetics(seed, []).hat).toBe('');
	}
});

test('LEGACY_HAT_IDS preserves the frozen pre-migration render-side HATS order', () => {
	expect(LEGACY_HAT_IDS).toEqual([
		'',
		'cap',
		'crown',
		'wizard',
		'top-hat',
		'party-hat',
	]);
});
