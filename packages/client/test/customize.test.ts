import { expect, test } from 'bun:test';
import { DEFAULT_COSMETICS, FORM_COUNT, HUE_COUNT } from '@mmo/shared';
import {
	CUSTOMIZE_FIELDS,
	customizeRows,
	effectiveHandle,
	HANDLE_MAX_LEN,
	handleConfirmable,
	initCustomize,
	reduceCustomize,
	typeHandleChar,
} from '../src/customize';

test('right cycles the focused field forward', () => {
	// Form is drafted down to a single shippable option, so it's hidden from the
	// picker and hue is the first (field 0) row.
	const s = initCustomize(DEFAULT_COSMETICS); // field 0 = hue
	const { state } = reduceCustomize(s, 'right');
	expect(state.cosmetics.hue).toBe(1);
	expect(state.cosmetics.form).toBe(0); // unfocused fields untouched
	expect(state.cosmetics.hat).toBe(0);
	expect(state.cosmetics.nameplate).toBe(0);
});

test('left wraps the focused field from 0 to the last index', () => {
	const s = initCustomize(DEFAULT_COSMETICS); // field 0 = hue (a multi-entry catalog)
	const { state } = reduceCustomize(s, 'left');
	expect(state.cosmetics.hue).toBe(HUE_COUNT - 1);
});

test('down moves focus to the next field, so right then cycles that field', () => {
	let s = initCustomize(DEFAULT_COSMETICS); // field 0 = hue
	s = reduceCustomize(s, 'down').state; // field 1 = hat
	expect(s.field).toBe(1);
	const { state } = reduceCustomize(s, 'right');
	expect(state.cosmetics.hat).toBe(1);
	expect(state.cosmetics.hue).toBe(0); // hue no longer focused
});

test('up wraps focus from the first field to the last', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state } = reduceCustomize(s, 'up');
	expect(state.field).toBe(CUSTOMIZE_FIELDS.length - 1);
});

test('return confirms with the chosen cosmetics, leaving them unchanged', () => {
	let s = initCustomize(DEFAULT_COSMETICS); // field 0 = hue
	s = reduceCustomize(s, 'right').state; // hue -> 1
	const { state, confirm } = reduceCustomize(s, 'return');
	expect(confirm).toBe(true);
	expect(state.cosmetics).toEqual({ hue: 1, hat: 0, nameplate: 0, form: 0 });
});

test('the single-option Form is hidden from the picker but still confirms as form 0', () => {
	// Form 2 (wisp) is drafted out pending art rework, leaving a single shippable
	// Form. A one-option field is no choice at all, so the picker hides the Form row
	// (no dead `1/1` switcher) — yet `form` stays a first-class, replicated cosmetic
	// pinned to 0 through confirm. Re-adding a second Form re-lists the row.
	expect(FORM_COUNT).toBe(1);
	expect(CUSTOMIZE_FIELDS.some((f) => f.key === 'form')).toBe(false);
	let s = initCustomize(DEFAULT_COSMETICS);
	s = reduceCustomize(s, 'right').state;
	const { state, confirm } = reduceCustomize(s, 'return');
	expect(confirm).toBe(true);
	expect(state.cosmetics.form).toBe(0);
});

test('customizeRows yields one focused-marked row per field, hat named from catalog', () => {
	let s = initCustomize(DEFAULT_COSMETICS); // field 0 = hue
	s = reduceCustomize(s, 'down').state; // focus the hat field
	const rows = customizeRows(s);
	expect(rows).toHaveLength(CUSTOMIZE_FIELDS.length);
	expect(rows[0]).toMatchObject({ label: 'Body hue', focused: false });
	// hat index 0 is the 'None' catalog entry, and it is the focused field now
	expect(rows[1]).toMatchObject({ label: 'Hat', value: 'None', focused: true });
	// a field with no catalog names shows its 1-based position out of the catalog size
	expect(rows[0].value).toBe(`1/${HUE_COUNT}`);
});

test('a key with no binding is a no-op and never confirms', () => {
	const s = initCustomize(DEFAULT_COSMETICS);
	const { state, confirm } = reduceCustomize(s, 'x');
	expect(confirm).toBe(false);
	expect(state).toEqual(s);
});

// --- Player-typed Handle (#304, ADR 0028) -----------------------------------------

test('typeHandleChar appends only legal characters, up to the cap', () => {
	expect(typeHandleChar('ne', 'o')).toBe('neo');
	expect(typeHandleChar('neo', '_')).toBe('neo_');
	expect(typeHandleChar('neo', '-')).toBe('neo-');
	expect(typeHandleChar('neo', 'X')).toBe('neoX');
	expect(typeHandleChar('neo', '7')).toBe('neo7');
	// Illegal characters (spaces, punctuation, multi-char sequences) are ignored.
	expect(typeHandleChar('neo', ' ')).toBe('neo');
	expect(typeHandleChar('neo', '!')).toBe('neo');
	expect(typeHandleChar('neo', 'ab')).toBe('neo');
	// The cap (matching the shared 2–16 rule) is enforced.
	const full = 'a'.repeat(HANDLE_MAX_LEN);
	expect(full.length).toBe(HANDLE_MAX_LEN);
	expect(typeHandleChar(full, 'b')).toBe(full);
});

test('effectiveHandle falls back to the placeholder only when the draft is empty', () => {
	expect(effectiveHandle('', 'wanderer')).toBe('wanderer');
	expect(effectiveHandle('   ', 'wanderer')).toBe('wanderer');
	expect(effectiveHandle('neo', 'wanderer')).toBe('neo');
});

test('handleConfirmable gates confirm on the shared 2–16 [A-Za-z0-9_-] rule', () => {
	// An empty draft uses the (valid) auto-derived placeholder, so confirm is allowed.
	expect(handleConfirmable('', 'wanderer')).toBe(true);
	// A one-character draft is too short: confirm is blocked until it becomes valid.
	expect(handleConfirmable('a', 'wanderer')).toBe(false);
	expect(handleConfirmable('ab', 'wanderer')).toBe(true);
	// The cap is respected; a 16-char handle is still valid.
	expect(handleConfirmable('a'.repeat(HANDLE_MAX_LEN), 'wanderer')).toBe(true);
});
