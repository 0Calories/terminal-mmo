// The pre-spawn Avatar customization picker (#36, PRD story 7; ADR 0005). This
// module is the PURE, testable seam: a small state machine over the three cosmetic
// choices (body hue, hat, nameplate colour) driven by directional keys. The
// retained-UI shell that mounts a live Sprite preview around it lives in
// character-creator.ts (rendering, eyeball-only per the PRD).
import {
	type Cosmetics,
	clampCosmetics,
	FORM_COUNT,
	HAT_COUNT,
	HATS,
	HUE_COUNT,
	NAMEPLATE_COUNT,
} from '@mmo/shared';

// The fields the Player cycles through, in display order. Each names the matching
// `Cosmetics` key, a human label, and how many catalog entries it has (the valid
// index range is [0, count)). Sourced from the shared catalogs so the picker can
// never offer an index the renderer / wire can't represent.
export type CustomizeFieldKey = keyof Cosmetics;

export interface CustomizeFieldDef {
	key: CustomizeFieldKey;
	label: string;
	count: number;
}

const ALL_CUSTOMIZE_FIELDS: readonly CustomizeFieldDef[] = [
	{ key: 'form', label: 'Form', count: FORM_COUNT },
	{ key: 'hue', label: 'Body hue', count: HUE_COUNT },
	{ key: 'hat', label: 'Hat', count: HAT_COUNT },
	{ key: 'nameplate', label: 'Nameplate', count: NAMEPLATE_COUNT },
];

// A field with a single catalog entry offers no real choice, so we hide it from
// the picker rather than render a dead `1/1` switcher row the Player can focus but
// never change. Today this drops the Form row: Form 2 (wisp) is drafted out pending
// art rework, leaving a single shippable Form. Shipping a second Form (FORM_COUNT
// back above 1) re-lists the row automatically — this gate is the whole "disable".
export const CUSTOMIZE_FIELDS: readonly CustomizeFieldDef[] =
	ALL_CUSTOMIZE_FIELDS.filter((f) => f.count > 1);

// Which field has focus (index into CUSTOMIZE_FIELDS) plus the current choices.
export interface CustomizeState {
	field: number;
	cosmetics: Cosmetics;
}

// Seed the picker from a starting look (e.g. a randomized one), focus the first
// field. Clamped so a stray index can never drive the picker out of range.
export function initCustomize(cosmetics: Cosmetics): CustomizeState {
	return { field: 0, cosmetics: clampCosmetics(cosmetics) };
}

function wrap(v: number, n: number): number {
	return ((v % n) + n) % n;
}

// One display row of the picker: the field label, the human-readable current
// value, and whether it has focus. The shell renders these verbatim, so the
// presentation logic stays here (pure + tested) rather than in the opentui mount.
export interface CustomizeRow {
	label: string;
	value: string;
	focused: boolean;
}

// The render model: a row per field. Hats have catalog names; the colour fields
// have none, so they show a 1-based position out of the catalog size.
export function customizeRows(s: CustomizeState): CustomizeRow[] {
	return CUSTOMIZE_FIELDS.map((f, i) => {
		const idx = s.cosmetics[f.key];
		const value = f.key === 'hat' ? HATS[idx].name : `${idx + 1}/${f.count}`;
		return { label: f.label, value, focused: i === s.field };
	});
}

// Step the focused field's chosen index by `delta`, wrapping within its catalog.
function cycle(s: CustomizeState, delta: number): CustomizeState {
	const f = CUSTOMIZE_FIELDS[s.field];
	const next = wrap(s.cosmetics[f.key] + delta, f.count);
	return { ...s, cosmetics: { ...s.cosmetics, [f.key]: next } };
}

// Apply one key to the picker. Returns the next state and whether the Player
// confirmed (Enter) — on confirm the caller reads `state.cosmetics` and connects.
export function reduceCustomize(
	s: CustomizeState,
	key: string,
): { state: CustomizeState; confirm: boolean } {
	switch (key) {
		case 'right':
			return { state: cycle(s, 1), confirm: false };
		case 'left':
			return { state: cycle(s, -1), confirm: false };
		case 'down':
			return {
				state: { ...s, field: wrap(s.field + 1, CUSTOMIZE_FIELDS.length) },
				confirm: false,
			};
		case 'up':
			return {
				state: { ...s, field: wrap(s.field - 1, CUSTOMIZE_FIELDS.length) },
				confirm: false,
			};
		case 'return':
			return { state: s, confirm: true };
		default:
			return { state: s, confirm: false };
	}
}
