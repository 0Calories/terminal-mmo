import { expect, test } from 'bun:test';
import { DEFAULT_COSMETICS, HUE_COUNT } from '@mmo/core/entities';
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
	expect(state.cosmetics).toEqual({ ...DEFAULT_COSMETICS, hue: 1 });
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
	expect(state.cosmetics.hat).not.toBe(DEFAULT_COSMETICS.hat);
	expect(state.cosmetics.hue).toBe(DEFAULT_COSMETICS.hue);
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
	expect(state.cosmetics).toEqual({ ...DEFAULT_COSMETICS, hue: 1 });
});

test('customizeRows yields one row per field and exactly one focus target', () => {
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'down').state;
	const rows = customizeRows(s);
	expect(rows).toHaveLength(CUSTOMIZE_FIELDS.length);
	expect(rows.filter((row) => row.focused)).toHaveLength(1);
	for (const row of rows) {
		expect(row.label.length).toBeGreaterThan(0);
		expect(row.value.length).toBeGreaterThan(0);
	}
});

test('a key with no binding is a no-op and never confirms', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state, confirm } = reduceCustomize(s, 'x');
	expect(confirm).toBe(false);
	expect(state).toEqual(s);
});

test('filterHandleDraft keeps legal characters and caps length', () => {
	for (const [draft, filtered] of [
		['neo', 'neo'],
		['Ne0-_', 'Ne0-_'],
		['ne o', 'neo'],
		['n!e@o#', 'neo'],
	] as const)
		expect(filterHandleDraft(draft)).toBe(filtered);
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
