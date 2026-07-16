// The `e` file-local colour picker modal (spec #387, issue #401). It DEFINES a
// new file-local colour or EDITS an existing one, seeding an auto-assigned
// single-char key (define) or the edited local's own key (edit). The artist
// composes a colour two ways over one shared RGBA: navigating a hue/shade grid
// (arrows / clicks) or typing a hex value — the two stay in sync. Reserved
// dynamic keys `p`/`a` are paintable but never definable, so the modal never
// opens an edit on them; it falls back to defining a fresh local instead.
//
// Pure state: no I/O, no `@opentui/core`. The TUI renders `ColorPickerState`,
// feeds keys/clicks through the reducers, and applies the emitted action (a
// `defineLocalColor` that both adds a new key and overwrites an edited one, so
// art already painted with that key updates the instant the colour changes).
import type { RGBAQuad } from '@mmo/core/entities';
import type { SpriteEditorState } from './state';

// The hue/shade grid dimensions: hue runs across the columns, lightness down the
// rows. A compact palette (Sweetie-16/PICO-8 class) the artist samples from.
export const HUE_COLS = 12;
export const SHADE_ROWS = 8;

// The reserved dynamic keys, never a file-local colour (mirrors the `.sprite`
// parser and `defineLocalColor`), and the transparent ink's UI spelling `t`,
// which an auto-assigned key must never shadow.
const RESERVED_KEYS = new Set(['p', 'a']);
const TRANSPARENT_KEY = 't';

// The candidate pool an auto key is drawn from, in preference order: lowercase,
// then uppercase, then digits. Single chars only — the parser's colour-key rule.
const KEY_POOL = [
	...'abcdefghijklmnopqrstuvwxyz',
	...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	...'0123456789',
];

// A sensible starting colour for a fresh define (a mid blue on the grid).
const DEFAULT_COLOR: RGBAQuad = [101, 176, 255, 255];

export type ColorPickerMode = 'define' | 'edit';

export interface ColorPickerState {
	readonly mode: ColorPickerMode;
	// The single-char key the commit writes: auto-assigned (define) or the edited
	// local's fixed key (edit).
	readonly key: string;
	// The colour being composed, always in step with `hex`.
	readonly rgba: RGBAQuad;
	// Grid cursor: column = hue, row = shade.
	readonly col: number;
	readonly row: number;
	// The hex entry buffer (0–6 lowercase hex digits, no leading '#'); a full six
	// digits drive `rgba`, a partial buffer just echoes what has been typed.
	readonly hex: string;
	// '' unless the last action was rejected.
	readonly error: string;
}

// The one action the modal emits: commit the composed colour under its key
// (define adds a new key, edit overwrites an existing one). Cancelling emits no
// action — the TUI just drops the modal.
export type ColorPickerAction = {
	readonly type: 'commit';
	readonly key: string;
	readonly rgba: RGBAQuad;
};

export interface ColorPickerResult {
	readonly picker: ColorPickerState | null;
	readonly action?: ColorPickerAction;
}

// ---------------------------------------------------------------------------
// Colour maths (pure)
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function hslToRgba(h: number, s: number, l: number): RGBAQuad {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	if (hp < 1) [r, g, b] = [c, x, 0];
	else if (hp < 2) [r, g, b] = [x, c, 0];
	else if (hp < 3) [r, g, b] = [0, c, x];
	else if (hp < 4) [r, g, b] = [0, x, c];
	else if (hp < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const m = l - c / 2;
	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
		255,
	];
}

// The colour at grid cell (col, row): hue across the columns, lightness top
// (light) to bottom (dark) at a fixed saturation, so every cell is a usable tint.
export function gridColor(col: number, row: number): RGBAQuad {
	const hue = (col / HUE_COLS) * 360;
	// Keep the extremes off pure white/black — a 0.9→0.12 lightness ramp.
	const l = 0.9 - (row / (SHADE_ROWS - 1)) * 0.78;
	return hslToRgba(hue, 0.65, l);
}

// The grid cell whose colour is nearest `rgba` (squared RGB distance), so opening
// on an existing colour lands the cursor somewhere sensible.
function nearestCell(rgba: RGBAQuad): { col: number; row: number } {
	let best = { col: 0, row: 0 };
	let bestD = Number.POSITIVE_INFINITY;
	for (let row = 0; row < SHADE_ROWS; row++)
		for (let col = 0; col < HUE_COLS; col++) {
			const g = gridColor(col, row);
			const d =
				(g[0] - rgba[0]) ** 2 + (g[1] - rgba[1]) ** 2 + (g[2] - rgba[2]) ** 2;
			if (d < bestD) {
				bestD = d;
				best = { col, row };
			}
		}
	return best;
}

export function rgbaToHex(rgba: RGBAQuad): string {
	return rgba
		.slice(0, 3)
		.map((n) => clamp(n, 0, 255).toString(16).padStart(2, '0'))
		.join('');
}

// Parse a full six-digit hex string to an opaque RGBA; caller guarantees length.
function hexToRgba(hex: string): RGBAQuad {
	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
		255,
	];
}

// ---------------------------------------------------------------------------
// Key assignment
// ---------------------------------------------------------------------------

// The first single-char key free for a new file-local colour: not a standard
// palette key, not an existing local, not a reserved dynamic key (`p`/`a`), and
// not the transparent spelling (`t`). Returns '' only if the whole pool is taken.
export function autoAssignKey(
	localKeys: Iterable<string>,
	paletteKeys: Iterable<string>,
): string {
	const taken = new Set<string>([
		...localKeys,
		...paletteKeys,
		...RESERVED_KEYS,
		TRANSPARENT_KEY,
	]);
	for (const k of KEY_POOL) if (!taken.has(k)) return k;
	return '';
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function seed(
	mode: ColorPickerMode,
	key: string,
	rgba: RGBAQuad,
): ColorPickerState {
	const { col, row } = nearestCell(rgba);
	return { mode, key, rgba, col, row, hex: rgbaToHex(rgba), error: '' };
}

// Open the modal for the editor's active ink. When that ink is an existing
// file-local colour, EDIT it in place (its key is fixed); otherwise DEFINE a new
// colour under a fresh auto-assigned key. A reserved `p`/`a` ink is never
// editable, so it opens the define flow — the picker never offers to edit them.
export function openColorPicker(
	state: SpriteEditorState,
	paletteKeys: Iterable<string>,
): ColorPickerState {
	const ink = state.ink;
	if (
		ink.kind === 'color' &&
		!RESERVED_KEYS.has(ink.key) &&
		ink.key in state.doc.colors
	)
		return seed('edit', ink.key, state.doc.colors[ink.key]);
	const key = autoAssignKey(Object.keys(state.doc.colors), paletteKeys);
	return seed('define', key, DEFAULT_COLOR);
}

// ---------------------------------------------------------------------------
// Navigation & entry (arrows / clicks / hex typeahead)
// ---------------------------------------------------------------------------

// Land the cursor on grid cell (col, row) — the shared body of arrow moves and
// grid clicks — syncing the composed colour and the hex echo to that cell.
export function pickCell(
	state: ColorPickerState,
	col: number,
	row: number,
): ColorPickerState {
	const c = clamp(col, 0, HUE_COLS - 1);
	const r = clamp(row, 0, SHADE_ROWS - 1);
	const rgba = gridColor(c, r);
	return { ...state, col: c, row: r, rgba, hex: rgbaToHex(rgba), error: '' };
}

export function moveCursor(
	state: ColorPickerState,
	dCol: number,
	dRow: number,
): ColorPickerState {
	return pickCell(state, state.col + dCol, state.row + dRow);
}

// Feed one printable char into the hex buffer: hex digits only. A completed
// six-digit buffer drives the composed colour; a partial buffer just echoes,
// leaving the colour as-is until it fills. Because the buffer opens seeded with
// the current colour's six digits, the next digit starts a FRESH entry — so the
// artist can just type a new colour over a grid/seed selection without clearing.
// Non-hex chars are ignored (the buffer, and colour, hold).
export function typeHex(state: ColorPickerState, ch: string): ColorPickerState {
	if (!/^[0-9a-fA-F]$/.test(ch)) return state;
	const base = state.hex.length >= 6 ? '' : state.hex;
	const hex = base + ch.toLowerCase();
	const rgba = hex.length === 6 ? hexToRgba(hex) : state.rgba;
	return { ...state, hex, rgba, error: '' };
}

export function backspaceHex(state: ColorPickerState): ColorPickerState {
	if (state.hex.length === 0) return state;
	const hex = state.hex.slice(0, -1);
	const rgba = hex.length === 6 ? hexToRgba(hex) : state.rgba;
	return { ...state, hex, rgba, error: '' };
}

// ---------------------------------------------------------------------------
// Commit / cancel
// ---------------------------------------------------------------------------

// Confirm the composed colour. Both define and edit emit one `commit` action —
// the TUI applies it as a `defineLocalColor`, which adds a new key or overwrites
// an edited one (updating every Pixel already painted with that key). A blank or
// reserved key can never be seeded, but is refused defensively rather than
// producing an illegal define.
export function commitColorPicker(state: ColorPickerState): ColorPickerResult {
	if (!state.key || RESERVED_KEYS.has(state.key))
		return {
			picker: {
				...state,
				error: `'${state.key}' cannot be a file-local colour key`,
			},
		};
	return {
		picker: null,
		action: { type: 'commit', key: state.key, rgba: state.rgba },
	};
}
