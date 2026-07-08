// The pre-spawn Avatar customization picker (#36, ADR 0005): the pure, testable seam.
// The retained-UI shell that mounts a live Sprite preview lives in character-creator.ts.
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
} from '@mmo/shared';

// --- Player-typed Handle (#304, #315, ADR 0028) -----------------------------------
// The rules behind the creator's editable name field (labelled "name" in the UI; the domain
// term stays Handle — #315). The Handle rule (chars, length) is owned by @mmo/shared so the
// client's typing gate and the server's claim can't diverge.
export { HANDLE_MAX_LEN } from '@mmo/shared';

// Live-filter a raw input value to a legal Handle draft: keep only shared-legal characters and
// cap at HANDLE_MAX_LEN, so illegal input never survives a keystroke.
export function filterHandleDraft(raw: string): string {
	const kept = Array.from(raw).filter((ch) => HANDLE_CHAR_RE.test(ch));
	return kept.slice(0, HANDLE_MAX_LEN).join('');
}

// The Handle actually submitted: the typed draft, or the placeholder when empty — still
// uniqueness-checked server-side (#304).
export function effectiveHandle(draft: string, placeholder: string): string {
	return draft.trim() || placeholder;
}

// Confirm is gated on the effective Handle passing the shared validHandle rule.
export function handleConfirmable(draft: string, placeholder: string): boolean {
	return validHandle(effectiveHandle(draft, placeholder));
}

// The fields the Player cycles through. Counts come from the shared catalogs so the
// picker can never offer an index the renderer / wire can't represent.
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

// A single-entry field offers no real choice, so hide it rather than render a dead
// `1/1` row. Today this drops Form (Form 2 drafted out pending art); shipping a second
// Form re-lists the row automatically.
export const CUSTOMIZE_FIELDS: readonly CustomizeFieldDef[] =
	ALL_CUSTOMIZE_FIELDS.filter((f) => f.count > 1);

export interface CustomizeState {
	field: number;
	cosmetics: Cosmetics;
}

// Seed the picker from a starting look; clamped so a stray index can't drive it out of range.
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

// A row per field. Hats show a catalog name; colour fields have none, so they show a
// 1-based position out of the catalog size.
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

// Apply one key. Returns the next state and whether the Player confirmed (Enter).
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
