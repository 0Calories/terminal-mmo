import { describe, expect, test } from 'bun:test';
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
} from '../../src/entities';

describe('Cosmetic normalization laws', () => {
	test('catalog dimensions and defaults stay internally consistent', () => {
		expect(HUE_COUNT).toBe(HUES.length);
		expect(NAMEPLATE_COUNT).toBe(NAMEPLATE_COLORS.length);
		expect(DEFAULT_COSMETICS.hue).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_COSMETICS.hue).toBeLessThan(HUE_COUNT);
		expect(DEFAULT_COSMETICS.nameplate).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_COSMETICS.nameplate).toBeLessThan(NAMEPLATE_COUNT);
		expect(DEFAULT_COSMETICS.form).toBe(DEFAULT_FORM_ID);
	});

	test('valid values pass through while invalid indices and value types use defaults', () => {
		const valid: Cosmetics = {
			hue: Math.min(1, HUE_COUNT - 1),
			hat: 'authored-hat',
			nameplate: Math.min(1, NAMEPLATE_COUNT - 1),
			form: 'authored-form',
		};
		expect(clampCosmetics(valid)).toEqual(valid);

		for (const invalid of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
			const normalized = clampCosmetics({
				hue: invalid,
				hat: 42 as unknown as string,
				nameplate: invalid,
				form: null as unknown as string,
			});
			expect(normalized).toEqual(DEFAULT_COSMETICS);
		}
	});

	test('id sanitizers accept members of the supplied catalog and reject everything else', () => {
		const hats = new Set(['hat-a', 'hat-b']);
		const forms = new Set(['form-a', 'form-b']);
		expect(sanitizeHatId('hat-b', hats)).toBe('hat-b');
		expect(sanitizeFormId('form-b', forms)).toBe('form-b');
		for (const invalid of ['missing', '', 1, null, undefined]) {
			expect(sanitizeHatId(invalid, hats)).toBe('');
			expect(sanitizeFormId(invalid, forms)).toBe(DEFAULT_FORM_ID);
		}
	});
});

describe('deterministic cosmetic generation', () => {
	const hats = ['hat-a', 'hat-b', 'hat-c'];
	const forms = ['form-a', 'form-b'];

	test('the same seed produces the same values inside supplied pools', () => {
		const generated = Array.from({ length: 100 }, (_, seed) =>
			randomCosmetics(seed, hats, forms),
		);
		expect(generated).toEqual(
			Array.from({ length: 100 }, (_, seed) =>
				randomCosmetics(seed, hats, forms),
			),
		);
		for (const value of generated) {
			expect(value.hue).toBeGreaterThanOrEqual(0);
			expect(value.hue).toBeLessThan(HUE_COUNT);
			expect(value.nameplate).toBeGreaterThanOrEqual(0);
			expect(value.nameplate).toBeLessThan(NAMEPLATE_COUNT);
			expect(['', ...hats]).toContain(value.hat);
			expect(forms).toContain(value.form);
		}
		expect(new Set(generated.map((value) => value.hat)).size).toBeGreaterThan(
			1,
		);
		expect(new Set(generated.map((value) => value.form)).size).toBeGreaterThan(
			1,
		);
	});

	test('empty authored pools fall back to the no-hat and default Form identities', () => {
		for (const seed of [0, 1, 17, 99]) {
			const value = randomCosmetics(seed, [], []);
			expect(value.hat).toBe('');
			expect(value.form).toBe(DEFAULT_FORM_ID);
		}
	});
});

test('frozen numeric cosmetic tables preserve pre-string wire and Save compatibility', () => {
	expect(LEGACY_HAT_IDS).toEqual([
		'',
		'cap',
		'crown',
		'wizard',
		'top-hat',
		'party-hat',
	]);
	expect(LEGACY_FORM_IDS).toEqual(['buddy']);
});
