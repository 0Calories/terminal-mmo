import type { RGBAQuad } from '@mmo/core/entities';
import type { SpriteEditorState } from './state';

export const HUE_COLS = 12;
export const SHADE_ROWS = 8;

const RESERVED_KEYS = new Set(['p', 'a']);
const TRANSPARENT_KEY = 't';

const KEY_POOL = [
	...'abcdefghijklmnopqrstuvwxyz',
	...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	...'0123456789',
];

const DEFAULT_COLOR: RGBAQuad = [101, 176, 255, 255];

export type ColorPickerMode = 'define' | 'edit';

export interface ColorPickerState {
	readonly mode: ColorPickerMode;

	readonly key: string;

	readonly rgba: RGBAQuad;

	readonly col: number;
	readonly row: number;

	readonly hex: string;

	readonly error: string;
}

export type ColorPickerAction = {
	readonly type: 'commit';
	readonly key: string;
	readonly rgba: RGBAQuad;
};

export interface ColorPickerResult {
	readonly picker: ColorPickerState | null;
	readonly action?: ColorPickerAction;
}

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

export function gridColor(col: number, row: number): RGBAQuad {
	const hue = (col / HUE_COLS) * 360;

	const l = 0.9 - (row / (SHADE_ROWS - 1)) * 0.78;
	return hslToRgba(hue, 0.65, l);
}

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

function hexToRgba(hex: string): RGBAQuad {
	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
		255,
	];
}

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

function seed(
	mode: ColorPickerMode,
	key: string,
	rgba: RGBAQuad,
): ColorPickerState {
	const { col, row } = nearestCell(rgba);
	return { mode, key, rgba, col, row, hex: rgbaToHex(rgba), error: '' };
}

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
