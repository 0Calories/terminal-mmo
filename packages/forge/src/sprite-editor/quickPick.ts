// The `c` ink quick-pick overlay (spec #387, locked in the #383 grill). It is
// the keyboard's random-access answer to the rail: any ink is reachable without
// stepping — by typeahead (its rail key char), by rail index (a digit), or by
// arrows — then Enter commits. Distinct from the define-color modal (`e`, issue
// #401): this overlay only SELECTS an existing ink, it never defines one. Pure
// state: no I/O, no `@opentui/core`; the TUI renders `QuickPickState`, feeds
// keys through the reducers, and applies the chosen `Ink`.
import {
	colorInk,
	type Ink,
	inkEquals,
	type PaletteEntry,
	TRANSPARENT_INK,
} from './state';

// One selectable row: a palette entry, or the transparent ink (always offered —
// transparent is a first-class ink, spec #387).
export type QuickPickOption =
	| { readonly kind: 'entry'; readonly entry: PaletteEntry }
	| { readonly kind: 'transparent' };

export interface QuickPickState {
	readonly options: readonly QuickPickOption[];
	readonly index: number;
	// The last typeahead/index char echoed to the artist ('' when idle).
	readonly query: string;
}

// The ink an option paints.
export function optionInk(o: QuickPickOption): Ink {
	return o.kind === 'transparent' ? TRANSPARENT_INK : colorInk(o.entry.key);
}

// The single char that jumps to this option in typeahead: a colour entry's key,
// or `t` for transparent (mirrors the rail's `t transparent` label).
export function optionKey(o: QuickPickOption): string {
	return o.kind === 'transparent' ? 't' : o.entry.key;
}

// Rail order: the palette entries as listed, then transparent (spec #387), so
// the overlay's index matches the rail's swatch order.
export function quickPickOptions(
	entries: readonly PaletteEntry[],
): QuickPickOption[] {
	return [
		...entries.map((entry) => ({ kind: 'entry', entry }) as QuickPickOption),
		{ kind: 'transparent' },
	];
}

// Open the overlay with the highlight landed on the currently active ink.
export function openQuickPick(
	entries: readonly PaletteEntry[],
	current: Ink,
): QuickPickState {
	const options = quickPickOptions(entries);
	const index = Math.max(
		0,
		options.findIndex((o) => inkEquals(optionInk(o), current)),
	);
	return { options, index, query: '' };
}

export function quickPickMove(
	state: QuickPickState,
	delta: number,
): QuickPickState {
	const n = state.options.length;
	if (n === 0) return state;
	return { ...state, index: (state.index + delta + n) % n, query: '' };
}

// Feed one printable char: a digit selects that 1-based rail index; any other
// char is typeahead, jumping to the first option whose key matches. A char that
// resolves nowhere leaves the highlight put (and is not echoed).
export function quickPickType(
	state: QuickPickState,
	ch: string,
): QuickPickState {
	if (ch.length !== 1 || ch === ' ') return state;
	// Typeahead by the option's rail key first, so a single-char colour key
	// always selects its own swatch even when that key is a digit.
	const byKey = state.options.findIndex((o) => optionKey(o) === ch);
	if (byKey >= 0) return { ...state, index: byKey, query: ch };
	if (/^[0-9]$/.test(ch)) {
		const idx = Number(ch) - 1;
		if (idx >= 0 && idx < state.options.length)
			return { ...state, index: idx, query: ch };
	}
	return state;
}

export function currentQuickOption(state: QuickPickState): QuickPickOption {
	return state.options[state.index];
}

// The ink the highlighted row commits to (Enter).
export function quickPickChoose(state: QuickPickState): Ink {
	return optionInk(state.options[state.index]);
}
