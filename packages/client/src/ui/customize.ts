import {
	type Cosmetics,
	clampCosmetics,
	HUE_COUNT,
	NAMEPLATE_COUNT,
} from '@mmo/core/entities';
import {
	HANDLE_CHAR_RE,
	HANDLE_MAX_LEN,
	validHandle,
} from '@mmo/core/persistence';
import { FORM_IDS, HAT_IDS } from '@mmo/render';

export { HANDLE_MAX_LEN } from '@mmo/core/persistence';

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
	// Present for id-cycled fields (hat): the field's value is a string id, and
	// this is the ordered pool of ids it cycles through, position by position.
	options?: readonly string[];
}

// '' ("None") always leads, then the scanned ids in sorted order.
const HAT_OPTIONS: readonly string[] = ['', ...HAT_IDS];

// Forms are id-cycled like hats, but never empty (no leading ''): the scanned
// Form ids in sorted order (ADR 0031), the same directory-scan registry the
// server validates against.
const FORM_OPTIONS: readonly string[] = FORM_IDS;

const ALL_CUSTOMIZE_FIELDS: readonly CustomizeFieldDef[] = [
	{
		key: 'form',
		label: 'Form',
		count: FORM_OPTIONS.length,
		options: FORM_OPTIONS,
	},
	{ key: 'hue', label: 'Body hue', count: HUE_COUNT },
	{
		key: 'hat',
		label: 'Hat',
		count: HAT_OPTIONS.length,
		options: HAT_OPTIONS,
	},
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
		const raw = s.cosmetics[f.key];
		const value = f.options
			? raw === ''
				? 'None'
				: String(raw)
			: `${(raw as number) + 1}/${f.count}`;
		return { label: f.label, value, focused: i === s.field };
	});
}

function cycle(s: CustomizeState, delta: number): CustomizeState {
	const f = CUSTOMIZE_FIELDS[s.field];
	if (f.options) {
		const cur = f.options.indexOf(s.cosmetics[f.key] as string);
		const idx = wrap((cur < 0 ? 0 : cur) + delta, f.options.length);
		return { ...s, cosmetics: { ...s.cosmetics, [f.key]: f.options[idx] } };
	}
	const next = wrap((s.cosmetics[f.key] as number) + delta, f.count);
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
