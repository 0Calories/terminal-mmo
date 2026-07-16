// Pure state machine for the Sprite editor's ink-picker overlay (ADR 0031,
// spec #387). It drives two flows: choosing the single active *ink* — a palette
// key, or transparent — from a list, and the minimal "define a new file-local
// color" sub-flow (pick an unused single char, then enter r,g,b). No I/O, no
// `@opentui/core`: the TUI renders the `PickerState` and feeds keys through the
// reducers, applying any emitted action to the underlying editor state.
import type { RGBAQuad } from '@mmo/core/entities';
import {
	colorInk,
	type Ink,
	type PaletteEntry,
	TRANSPARENT_INK,
} from './state';

// One selectable row: an existing palette key, the transparent ink, or the
// "define a new local color" entry point. Transparent is a first-class ink, so
// the row is always offered (spec #387 — transparent is not the absence of ink).
export type PickerOption =
	| { kind: 'entry'; entry: PaletteEntry }
	| { kind: 'transparent' }
	| { kind: 'new' };

// The new-local-color form: enter a key char, then r, g, b (each confirmed).
export interface NewColorForm {
	stage: 'key' | 'r' | 'g' | 'b';
	key: string;
	r: string;
	g: string;
	b: string;
}

export interface PickerState {
	options: readonly PickerOption[];
	index: number;
	// null in list view; a form while defining a new local color.
	form: NewColorForm | null;
	// A human-readable reason the last form input was rejected; '' otherwise.
	error: string;
}

// What the reducer asks the caller to apply once an option is chosen / the form
// completes / the overlay is dismissed.
export type PickerAction =
	| { type: 'setInk'; ink: Ink }
	| { type: 'defineColor'; key: string; rgba: RGBAQuad }
	| { type: 'close' };

export function buildPickerOptions(
	entries: readonly PaletteEntry[],
): PickerOption[] {
	const opts: PickerOption[] = [{ kind: 'transparent' }];
	for (const entry of entries) opts.push({ kind: 'entry', entry });
	opts.push({ kind: 'new' });
	return opts;
}

// Open the overlay, landing the cursor on the currently active ink.
export function openPicker(
	entries: readonly PaletteEntry[],
	current: Ink,
): PickerState {
	const options = buildPickerOptions(entries);
	const index =
		current.kind === 'transparent'
			? options.findIndex((o) => o.kind === 'transparent')
			: options.findIndex(
					(o) => o.kind === 'entry' && o.entry.key === current.key,
				);
	return { options, index: index < 0 ? 0 : index, form: null, error: '' };
}

export function pickerMove(state: PickerState, delta: number): PickerState {
	const n = state.options.length;
	if (n === 0) return state;
	return { ...state, index: (state.index + delta + n) % n, error: '' };
}

export function currentOption(state: PickerState): PickerOption {
	return state.options[state.index];
}

// The reducer for the list view (form === null). Returns the next picker state
// (or null to keep the overlay closed) plus an optional action to apply.
export interface PickerResult {
	picker: PickerState | null;
	action?: PickerAction;
}

// Choose the highlighted row. An 'entry'/'transparent' resolves immediately to a
// setInk action and closes; 'new' opens the define-color form.
export function pickerChoose(state: PickerState): PickerResult {
	const opt = currentOption(state);
	if (!opt) return { picker: null, action: { type: 'close' } };
	if (opt.kind === 'new') {
		return {
			picker: {
				...state,
				form: { stage: 'key', key: '', r: '', g: '', b: '' },
				error: '',
			},
		};
	}
	if (opt.kind === 'transparent')
		return { picker: null, action: { type: 'setInk', ink: TRANSPARENT_INK } };
	return {
		picker: null,
		action: { type: 'setInk', ink: colorInk(opt.entry.key) },
	};
}

const RESERVED = new Set(['p', 'a']);

// Feed one printable character into the active form field.
export function formInput(state: PickerState, ch: string): PickerState {
	const f = state.form;
	if (!f) return state;
	if (f.stage === 'key') {
		// One usable, non-reserved char.
		if (ch.length !== 1 || ch === ' ') return state;
		return { ...state, form: { ...f, key: ch }, error: '' };
	}
	// r/g/b: accept digits only, cap at 3 chars.
	if (!/[0-9]/.test(ch)) return state;
	const field = f[f.stage];
	if (field.length >= 3) return state;
	return { ...state, form: { ...f, [f.stage]: field + ch }, error: '' };
}

export function formBackspace(state: PickerState): PickerState {
	const f = state.form;
	if (!f) return state;
	if (f.stage === 'key')
		return { ...state, form: { ...f, key: '' }, error: '' };
	const field = f[f.stage];
	return { ...state, form: { ...f, [f.stage]: field.slice(0, -1) }, error: '' };
}

const NEXT_STAGE: Record<NewColorForm['stage'], NewColorForm['stage'] | null> =
	{
		key: 'r',
		r: 'g',
		g: 'b',
		b: null,
	};

// Confirm the current field (Enter). Advances stages; on the final field it
// validates and emits a `defineColor` action, closing the overlay.
export function formAdvance(state: PickerState): PickerResult {
	const f = state.form;
	if (!f) return { picker: state };
	if (f.stage === 'key') {
		if (f.key.length !== 1)
			return {
				picker: { ...state, error: 'pick a single character key' },
			};
		if (RESERVED.has(f.key))
			return {
				picker: {
					...state,
					error: `'${f.key}' is a reserved dynamic key`,
				},
			};
		return { picker: { ...state, form: { ...f, stage: 'r' }, error: '' } };
	}
	const next = NEXT_STAGE[f.stage];
	if (next)
		return { picker: { ...state, form: { ...f, stage: next }, error: '' } };
	// Final field (b): validate the whole triple.
	const nums = [f.r, f.g, f.b].map((v) => Number.parseInt(v, 10));
	if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
		return {
			picker: { ...state, error: 'each of r,g,b must be 0..255' },
		};
	const rgba: RGBAQuad = [nums[0], nums[1], nums[2], 255];
	return {
		picker: null,
		action: { type: 'defineColor', key: f.key, rgba },
	};
}

// Escape: step the form back a stage, or close the overlay from the list view.
export function pickerBack(state: PickerState): PickerResult {
	const f = state.form;
	if (!f) return { picker: null, action: { type: 'close' } };
	const order: NewColorForm['stage'][] = ['key', 'r', 'g', 'b'];
	const i = order.indexOf(f.stage);
	if (i <= 0) return { picker: { ...state, form: null, error: '' } };
	return {
		picker: { ...state, form: { ...f, stage: order[i - 1] }, error: '' },
	};
}
