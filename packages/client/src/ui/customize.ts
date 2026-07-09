import {
	type Cosmetics,
	clampCosmetics,
	FORM_COUNT,
	HANDLE_CHAR_RE,
	HANDLE_MAX_LEN,
	HAT_COUNT,
	HATS,
	HUE_COUNT,
	NAMEPLATE_COUNT,
	validHandle,
} from '@mmo/core';

export { HANDLE_MAX_LEN } from '@mmo/core';

export function filterHandleDraft(raw: string): string {
	const kept = Array.from(raw).filter((ch) => HANDLE_CHAR_RE.test(ch));
	return kept.slice(0, HANDLE_MAX_LEN).join('');
}

export function effectiveHandle(draft: string, placeholder: string): string {
	return draft.trim() || placeholder;
}

export function handleConfirmable(draft: string, placeholder: string): boolean {
	return validHandle(effectiveHandle(draft, placeholder));
}

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

// Hide single-entry fields rather than render a dead `1/1` row.
export const CUSTOMIZE_FIELDS: readonly CustomizeFieldDef[] =
	ALL_CUSTOMIZE_FIELDS.filter((f) => f.count > 1);

export interface CustomizeState {
	field: number;
	cosmetics: Cosmetics;
}

export function initCustomize(cosmetics: Cosmetics): CustomizeState {
	return { field: 0, cosmetics: clampCosmetics(cosmetics) };
}

function wrap(v: number, n: number): number {
	return ((v % n) + n) % n;
}

export interface CustomizeRow {
	label: string;
	value: string;
	focused: boolean;
}

export function customizeRows(s: CustomizeState): CustomizeRow[] {
	return CUSTOMIZE_FIELDS.map((f, i) => {
		const idx = s.cosmetics[f.key];
		const value = f.key === 'hat' ? HATS[idx].name : `${idx + 1}/${f.count}`;
		return { label: f.label, value, focused: i === s.field };
	});
}

function cycle(s: CustomizeState, delta: number): CustomizeState {
	const f = CUSTOMIZE_FIELDS[s.field];
	const next = wrap(s.cosmetics[f.key] + delta, f.count);
	return { ...s, cosmetics: { ...s.cosmetics, [f.key]: next } };
}

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
