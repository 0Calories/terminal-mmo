import { expect, test } from 'bun:test';
import {
	type Cosmetics,
	clampCosmetics,
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	HUE_COUNT,
	HUES,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
	NAMEPLATE_COLORS,
	NAMEPLATE_COUNT,
	randomCosmetics,
	sanitizeFormId,
	sanitizeHatId,
} from '../src';

test('the default cosmetics are the first slot of every catalog (bareheaded amber, buddy Form)', () => {
	expect(DEFAULT_COSMETICS).toEqual({
		hue: 0,
		hat: '',
		nameplate: 0,
		form: 'buddy',
	});
});

test('catalog counts agree with the underlying catalogs', () => {
	expect(HUE_COUNT).toBe(HUES.length);
	expect(NAMEPLATE_COUNT).toBe(NAMEPLATE_COLORS.length);
});

test('clampCosmetics passes valid indices + a string hat + a string form through unchanged', () => {
	const c: Cosmetics = { hue: 1, hat: 'top-hat', nameplate: 3, form: 'buddy' };
	expect(clampCosmetics(c)).toEqual(c);
});

test('clampCosmetics collapses out-of-range / non-integer indices to the default', () => {
	expect(
		clampCosmetics({ hue: 999, hat: '', nameplate: 1.5, form: 'buddy' }),
	).toEqual(DEFAULT_COSMETICS);
	expect(
		clampCosmetics({
			hue: Number.NaN,
			hat: '',
			nameplate: -0.1,
			form: 'buddy',
		}),
	).toEqual(DEFAULT_COSMETICS);
});

test('clampCosmetics collapses a non-string hat to the empty (no-hat) id', () => {
	const c = {
		hue: 0,
		hat: 250 as unknown as string,
		nameplate: 0,
		form: 'buddy',
	} as Cosmetics;
	expect(clampCosmetics(c).hat).toBe('');
});

test('clampCosmetics passes an arbitrary string form through (validation is not core clamp job)', () => {
	const base = { hue: 0, hat: '', nameplate: 0 };
	expect(clampCosmetics({ ...base, form: 'wisp' }).form).toBe('wisp');
	expect(clampCosmetics({ ...base, form: 'buddy' }).form).toBe('buddy');
});

test('clampCosmetics collapses a non-string form to the default form id', () => {
	const base = { hue: 0, hat: '', nameplate: 0 };
	expect(clampCosmetics({ ...base, form: 3 as unknown as string }).form).toBe(
		DEFAULT_FORM_ID,
	);
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
	const formIds = ['buddy', 'wisp'];
	for (let seed = 0; seed < 200; seed++) {
		const c = randomCosmetics(seed, hatIds, formIds);
		expect(c).toEqual(randomCosmetics(seed, hatIds, formIds));
		expect(clampCosmetics(c)).toEqual(c);
		expect(c.hue).toBeGreaterThanOrEqual(0);
		expect(c.hue).toBeLessThan(HUE_COUNT);
		expect(['', ...hatIds]).toContain(c.hat);
		expect(c.nameplate).toBeLessThan(NAMEPLATE_COUNT);
		expect(formIds).toContain(c.form);
	}
});

test('randomCosmetics spreads across the catalogs (not a constant)', () => {
	const hatIds = ['cap', 'crown', 'wizard'];
	const formIds = ['buddy', 'wisp'];
	const hats = new Set<string>();
	const forms = new Set<string>();
	for (let seed = 1; seed <= 50; seed++) {
		hats.add(randomCosmetics(seed, hatIds, formIds).hat);
		forms.add(randomCosmetics(seed, hatIds, formIds).form);
	}
	expect(hats.size).toBeGreaterThan(1);
	// draws spread across the supplied form pool
	expect(forms.size).toBeGreaterThan(1);
	for (const f of forms) expect(formIds).toContain(f);
});

test('randomCosmetics with no form pool always draws the default form id', () => {
	for (let seed = 0; seed < 20; seed++) {
		expect(randomCosmetics(seed).form).toBe(DEFAULT_FORM_ID);
		expect(randomCosmetics(seed, [], []).form).toBe(DEFAULT_FORM_ID);
	}
});

test('randomCosmetics with no hat pool always draws the no-hat id', () => {
	for (let seed = 0; seed < 20; seed++) {
		expect(randomCosmetics(seed).hat).toBe('');
		expect(randomCosmetics(seed, []).hat).toBe('');
	}
});

test('sanitizeFormId passes through an id in the valid set', () => {
	const valid = new Set(['buddy', 'wisp']);
	expect(sanitizeFormId('wisp', valid)).toBe('wisp');
});

test('sanitizeFormId falls back to the default form id for a dangling / unknown id', () => {
	const valid = new Set(['buddy']);
	expect(sanitizeFormId('wisp', valid)).toBe(DEFAULT_FORM_ID);
	expect(sanitizeFormId('', valid)).toBe(DEFAULT_FORM_ID);
});

test('sanitizeFormId falls back to the default form id for a non-string value', () => {
	const valid = new Set(['buddy']);
	expect(sanitizeFormId(1 as unknown as string, valid)).toBe(DEFAULT_FORM_ID);
	expect(sanitizeFormId(undefined as unknown as string, valid)).toBe(
		DEFAULT_FORM_ID,
	);
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

test('LEGACY_FORM_IDS preserves the frozen pre-migration Form order (buddy at index 0)', () => {
	expect(LEGACY_FORM_IDS).toEqual(['buddy']);
	expect(DEFAULT_FORM_ID).toBe('buddy');
});
