import { expect, test } from 'bun:test';
import { DEFAULT_COSMETICS, FORM_COUNT, HUE_COUNT } from '@mmo/core';
import {
	CUSTOMIZE_FIELDS,
	customizeRows,
	effectiveHandle,
	filterHandleDraft,
	HANDLE_MAX_LEN,
	handleConfirmable,
	initCustomize,
	reduceCustomize,
} from '../src/ui/customize';

test('right cycles the focused field forward', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state } = reduceCustomize(s, 'right');
	expect(state.cosmetics.hue).toBe(1);
	expect(state.cosmetics.form).toBe(0);
	expect(state.cosmetics.hat).toBe(0);
	expect(state.cosmetics.nameplate).toBe(0);
});

test('left wraps the focused field from 0 to the last index', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state } = reduceCustomize(s, 'left');
	expect(state.cosmetics.hue).toBe(HUE_COUNT - 1);
});

test('down moves focus to the next field, so right then cycles that field', () => {
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'down').state;
	expect(s.field).toBe(1);
	const { state } = reduceCustomize(s, 'right');
	expect(state.cosmetics.hat).toBe(1);
	expect(state.cosmetics.hue).toBe(0);
});

test('up wraps focus from the first field to the last', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state } = reduceCustomize(s, 'up');
	expect(state.field).toBe(CUSTOMIZE_FIELDS.length - 1);
});

test('return confirms with the chosen cosmetics, leaving them unchanged', () => {
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'right').state;
	const { state, confirm } = reduceCustomize(s, 'return');
	expect(confirm).toBe(true);
	expect(state.cosmetics).toEqual({ hue: 1, hat: 0, nameplate: 0, form: 0 });
});

test('the single-option Form is hidden from the picker but still confirms as form 0', () => {
	expect(FORM_COUNT).toBe(1);
	expect(CUSTOMIZE_FIELDS.some((f) => f.key === 'form')).toBe(false);
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'right').state;
	const { state, confirm } = reduceCustomize(s, 'return');
	expect(confirm).toBe(true);
	expect(state.cosmetics.form).toBe(0);
});

test('customizeRows yields one focused-marked row per field, hat named from catalog', () => {
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'down').state;
	const rows = customizeRows(s);
	expect(rows).toHaveLength(CUSTOMIZE_FIELDS.length);
	expect(rows[0]).toMatchObject({ label: 'Body hue', focused: false });
	expect(rows[1]).toMatchObject({ label: 'Hat', value: 'None', focused: true });
	expect(rows[0].value).toBe(`1/${HUE_COUNT}`);
});

test('a key with no binding is a no-op and never confirms', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state, confirm } = reduceCustomize(s, 'x');
	expect(confirm).toBe(false);
	expect(state).toEqual(s);
});

test('filterHandleDraft keeps only legal characters and caps at the max length', () => {
	expect(filterHandleDraft('neo')).toBe('neo');
	expect(filterHandleDraft('Ne0-_')).toBe('Ne0-_');
	expect(filterHandleDraft('ne o')).toBe('neo');
	expect(filterHandleDraft('n!e@o#')).toBe('neo');
	expect(filterHandleDraft('  n e o  ')).toBe('neo');
	const full = 'a'.repeat(HANDLE_MAX_LEN);
	expect(full.length).toBe(HANDLE_MAX_LEN);
	expect(filterHandleDraft(`${full}bcd`)).toBe(full);
	expect(filterHandleDraft(`${'a'.repeat(HANDLE_MAX_LEN)}   `)).toBe(full);
});

test('effectiveHandle falls back to the placeholder only when the draft is empty', () => {
	expect(effectiveHandle('', 'wanderer')).toBe('wanderer');
	expect(effectiveHandle('   ', 'wanderer')).toBe('wanderer');
	expect(effectiveHandle('neo', 'wanderer')).toBe('neo');
});

test('handleConfirmable gates confirm on the shared 2–16 [A-Za-z0-9_-] rule', () => {
	expect(handleConfirmable('', 'wanderer')).toBe(true);
	expect(handleConfirmable('a', 'wanderer')).toBe(false);
	expect(handleConfirmable('ab', 'wanderer')).toBe(true);
	expect(handleConfirmable('a'.repeat(HANDLE_MAX_LEN), 'wanderer')).toBe(true);
});
