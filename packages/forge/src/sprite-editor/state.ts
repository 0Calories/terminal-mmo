// The Sprite editor's pure, headless state module (ADR 0031). Everything the
// forge `sprite edit` TUI needs to draw quadrant pixel art lives here as pure
// functions over an immutable state: a quadrant pixel canvas with the fg+bg
// expressibility rules, a glyph stamp Tool, color-key selection, undo/redo, and
// save. No TUI, no I/O — the TUI slice wires these to keys and the screen.
//
// Cell / pixel model. Each terminal *cell* of the current frame is a 2×2 grid
// of quadrant *pixels*. A cell carries at most two colors — a foreground key
// (the `@colors` grid, defaulting to `doc.key`) painting the lit quadrants, and
// an optional background key (the `@bg` grid) filling the *complement*. The
// three legal cell states (ADR 0031):
//   (a) empty                  — mask 0, no bg.
//   (b) one color + transparency — fg key + mask 1..15, transparent bg; the
//       unlit quadrants show the scene behind.
//   (c) two colors, fully opaque — fg key + mask 1..14, bg key filling the
//       complement; nothing transparent.
// Never two colors *and* transparency; never three colors. Every operation here
// preserves that invariant or refuses with `feedback` — no refusal is silent.
import type { RGBAQuad } from '@mmo/core';
import {
	glyphFromQuadrants,
	parseSpriteFile,
	quadrantsFromGlyph,
	SENTINEL,
	type SpriteDiagnostic,
	type SpriteDoc,
	type SpriteFrameDoc,
	serializeSpriteFile,
} from '@mmo/render';
import {
	canRedo,
	canUndo,
	type History,
	initHistory,
	record,
	redo,
	undo,
} from '../history';

export type SpriteTool = 'paint' | 'erase' | 'stamp';

// A selected background: a color key, or `null` for a transparent background.
export type BgSelection = string | null;

export interface SpriteEditorState {
	doc: SpriteDoc;
	// Name of the frame currently being edited.
	frame: string;
	// Cursor in PIXEL coordinates (2× the cell resolution on each axis).
	cursor: { x: number; y: number };
	tool: SpriteTool;
	fgKey: string;
	bgKey: BgSelection;
	// The human-readable reason the last operation was refused; '' on success.
	feedback: string;
	history: History<SpriteDoc>;
	// The active coalescing stroke tag (null between strokes) and its counter.
	stroke: string | null;
	strokeSeq: number;
}

// A resolved view of one cell: `fg`/`bg` are '' when transparent, and `mask` is
// undefined for a stamped (non-quadrant) glyph.
export interface CellView {
	glyph: string;
	fg: string;
	bg: string;
	mask: number | undefined;
}

export interface PaletteEntry {
	key: string;
	rgba: RGBAQuad;
	label: string;
	kind: 'local' | 'palette' | 'dynamic';
}

export interface DynamicPreviews {
	// Representative preview colors for the two dynamic recolor channels, injected
	// by the caller (the state module never imports a client/palette directly).
	p: RGBAQuad;
	a: RGBAQuad;
}

// The dynamic recolor keys, usable in grids but never file-local `colors`.
const RESERVED_KEYS = new Set(['p', 'a']);
const DEFAULT_KEY = 'p';

// ---------------------------------------------------------------------------
// Construction & reads
// ---------------------------------------------------------------------------

export function initSpriteEditor(
	doc: SpriteDoc,
	frame?: string,
): SpriteEditorState {
	const name = frame ?? doc.frames[0]?.name ?? '';
	return {
		doc,
		frame: name,
		cursor: { x: 0, y: 0 },
		tool: 'paint',
		fgKey: doc.key,
		bgKey: null,
		feedback: '',
		history: initHistory(doc),
		stroke: null,
		strokeSeq: 0,
	};
}

export function currentFrame(state: SpriteEditorState): SpriteFrameDoc {
	const f = state.doc.frames.find((fr) => fr.name === state.frame);
	if (!f) throw new Error(`no such frame '${state.frame}'`);
	return f;
}

export function frameNames(state: SpriteEditorState): string[] {
	return state.doc.frames.map((f) => f.name);
}

// Cell extent of a frame, in cells.
export function frameExtent(frame: SpriteFrameDoc): { w: number; h: number } {
	return { w: frame.rows[0]?.length ?? 0, h: frame.rows.length };
}

export function pixelToCell(
	px: number,
	py: number,
): { cellX: number; cellY: number; bit: number } {
	const cellX = Math.floor(px / 2);
	const cellY = Math.floor(py / 2);
	const sx = px - cellX * 2;
	const sy = py - cellY * 2;
	// Bit layout: bit0=TL, bit1=TR, bit2=BL, bit3=BR.
	return { cellX, cellY, bit: sx + sy * 2 };
}

export function cellAt(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
): CellView {
	const frame = currentFrame(state);
	const { w, h } = frameExtent(frame);
	if (cellX < 0 || cellY < 0 || cellX >= w || cellY >= h)
		return { glyph: ' ', fg: '', bg: '', mask: 0 };
	const glyph = frame.rows[cellY][cellX];
	const fgRaw = frame.colors[cellY][cellX];
	const bgRaw = frame.bg[cellY][cellX];
	return {
		glyph,
		fg: fgRaw === ' ' ? '' : fgRaw,
		bg: bgRaw === ' ' ? '' : bgRaw,
		mask: quadrantsFromGlyph(glyph),
	};
}

// Whether the given sub-pixel is a lit foreground quadrant.
export function readPixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): boolean {
	if (px < 0 || py < 0) return false;
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined) return false;
	return (cell.mask & (1 << bit)) !== 0;
}

// ---------------------------------------------------------------------------
// Immutable grid helpers
// ---------------------------------------------------------------------------

function grownFrame(
	frame: SpriteFrameDoc,
	cellX: number,
	cellY: number,
): SpriteFrameDoc {
	const { w, h } = frameExtent(frame);
	const newW = Math.max(w, cellX + 1);
	const newH = Math.max(h, cellY + 1);
	if (newW === w && newH === h) return frame;
	const grow = (grid: readonly string[]): string[] => {
		const out = grid.map((row) => row.padEnd(newW, ' '));
		while (out.length < newH) out.push(' '.repeat(newW));
		return out;
	};
	return {
		...frame,
		rows: grow(frame.rows),
		colors: grow(frame.colors),
		bg: grow(frame.bg),
	};
}

function setChar(row: string, x: number, ch: string): string {
	return row.slice(0, x) + ch + row.slice(x + 1);
}

function writeCell(
	frame: SpriteFrameDoc,
	cellX: number,
	cellY: number,
	glyph: string,
	fgChar: string,
	bgChar: string,
): SpriteFrameDoc {
	const grown = grownFrame(frame, cellX, cellY);
	return {
		...grown,
		rows: grown.rows.map((r, y) =>
			y === cellY ? setChar(r, cellX, glyph) : r,
		),
		colors: grown.colors.map((r, y) =>
			y === cellY ? setChar(r, cellX, fgChar) : r,
		),
		bg: grown.bg.map((r, y) => (y === cellY ? setChar(r, cellX, bgChar) : r)),
	};
}

function replaceFrame(doc: SpriteDoc, frame: SpriteFrameDoc): SpriteDoc {
	return {
		...doc,
		frames: doc.frames.map((f) => (f.name === frame.name ? frame : f)),
	};
}

function refuse(state: SpriteEditorState, message: string): SpriteEditorState {
	return { ...state, feedback: message };
}

function commitDoc(
	state: SpriteEditorState,
	nextDoc: SpriteDoc,
	tag?: string,
): SpriteEditorState {
	return {
		...state,
		doc: nextDoc,
		history: record(state.history, nextDoc, tag),
		feedback: '',
	};
}

function commitFrame(
	state: SpriteEditorState,
	frame: SpriteFrameDoc,
	tag?: string,
): SpriteEditorState {
	return commitDoc(state, replaceFrame(state.doc, frame), tag);
}

// ---------------------------------------------------------------------------
// Strokes — contiguous paint/erase drags coalesce into one undo step
// ---------------------------------------------------------------------------

export function beginStroke(state: SpriteEditorState): SpriteEditorState {
	const seq = state.strokeSeq + 1;
	return { ...state, stroke: `stroke${seq}`, strokeSeq: seq };
}

export function endStroke(state: SpriteEditorState): SpriteEditorState {
	return { ...state, stroke: null };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function setTool(
	state: SpriteEditorState,
	tool: SpriteTool,
): SpriteEditorState {
	return { ...state, tool, feedback: '' };
}

export function moveCursor(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return { ...state, cursor: { x: Math.max(0, px), y: Math.max(0, py) } };
}

function validKey(key: string): boolean {
	return key.length === 1 && key !== SENTINEL && key !== ' ';
}

export function setFgKey(
	state: SpriteEditorState,
	key: string,
): SpriteEditorState {
	if (!validKey(key))
		return refuse(state, `'${key}' is not a usable color key`);
	return { ...state, fgKey: key, feedback: '' };
}

export function setBgKey(
	state: SpriteEditorState,
	key: BgSelection,
): SpriteEditorState {
	if (key !== null && !validKey(key))
		return refuse(state, `'${key}' is not a usable color key`);
	return { ...state, bgKey: key, feedback: '' };
}

export function selectFrame(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	if (!state.doc.frames.some((f) => f.name === name))
		return refuse(state, `no such frame '${name}'`);
	return { ...state, frame: name, stroke: null, feedback: '' };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export function paintPixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	if (px < 0 || py < 0) return refuse(state, 'cannot paint outside the canvas');
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined)
		return refuse(
			state,
			`this cell holds a stamped glyph '${cell.glyph}' — clear it first`,
		);
	const t = 1 << bit;
	const sf = state.fgKey;
	const hasFg = cell.mask > 0;
	if (hasFg && cell.fg !== sf)
		return refuse(
			state,
			`this cell already uses color '${cell.fg}' — select '${cell.fg}' to extend it, or erase first`,
		);

	const newMask = cell.mask | t;
	// The complement (unlit quadrants) is one uniform color: the selected bg, or
	// transparent when none is selected. A full mask leaves no complement, so any
	// bg would be invisible — it is dropped, demoting the cell to one color.
	let newBgKey = state.bgKey === null ? cell.bg : state.bgKey;
	if (newMask === 15) newBgKey = '';

	const glyph = glyphFromQuadrants(newMask);
	const bgChar = newBgKey === '' ? ' ' : newBgKey;
	// No-op: the pixel is already exactly this — don't grow history.
	if (glyph === cell.glyph && sf === cell.fg && bgChar === (cell.bg || ' '))
		return { ...state, feedback: '' };
	const frame = writeCell(currentFrame(state), cellX, cellY, glyph, sf, bgChar);
	return commitFrame(state, frame, state.stroke ?? undefined);
}

export function erasePixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined)
		return refuse(
			state,
			`this cell holds a stamped glyph '${cell.glyph}' — clear it first`,
		);
	if (cell.mask === 0) return { ...state, feedback: '' };
	// Erasing a sub-pixel of a two-color cell would leave a transparent hole
	// beside a bg color — two colors + transparency, which is inexpressible.
	if (cell.bg !== '')
		return refuse(
			state,
			`this cell has a background color '${cell.bg}' — clear the cell before erasing pixels`,
		);
	const t = 1 << bit;
	if ((cell.mask & t) === 0) return { ...state, feedback: '' };
	const newMask = cell.mask & ~t;
	const glyph = glyphFromQuadrants(newMask);
	const fgChar = newMask === 0 ? ' ' : cell.fg;
	const frame = writeCell(
		currentFrame(state),
		cellX,
		cellY,
		glyph,
		fgChar,
		' ',
	);
	return commitFrame(state, frame, state.stroke ?? undefined);
}

// ---------------------------------------------------------------------------
// Glyph stamp
// ---------------------------------------------------------------------------

export function stampGlyph(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
	char: string,
): SpriteEditorState {
	if (cellX < 0 || cellY < 0)
		return refuse(state, 'cannot stamp outside the canvas');
	if ([...char].length !== 1)
		return refuse(state, 'a stamp is a single character');
	if (char === SENTINEL || char === ' ')
		return refuse(state, 'use clearCell to empty a cell');
	const bgChar = state.bgKey === null ? ' ' : state.bgKey;
	const frame = writeCell(
		currentFrame(state),
		cellX,
		cellY,
		char,
		state.fgKey,
		bgChar,
	);
	return commitFrame(state, frame);
}

export function clearCell(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
): SpriteEditorState {
	const cell = cellAt(state, cellX, cellY);
	if (cell.glyph === ' ' && cell.bg === '') return { ...state, feedback: '' };
	const frame = writeCell(currentFrame(state), cellX, cellY, ' ', ' ', ' ');
	return commitFrame(state, frame);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

function validRgba(v: unknown): v is RGBAQuad {
	return (
		Array.isArray(v) &&
		v.length === 4 &&
		v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
	);
}

export function defineLocalColor(
	state: SpriteEditorState,
	key: string,
	rgba: RGBAQuad,
): SpriteEditorState {
	if (RESERVED_KEYS.has(key))
		return refuse(
			state,
			`'${key}' is a reserved dynamic key and cannot be defined`,
		);
	if (key.length !== 1)
		return refuse(state, 'a color key must be a single character');
	if (key === SENTINEL || key === ' ')
		return refuse(state, `'${key}' cannot be a color key`);
	if (!validRgba(rgba))
		return refuse(state, 'a color must be [r,g,b,a] with each 0..255');
	const nextDoc: SpriteDoc = {
		...state.doc,
		colors: { ...state.doc.colors, [key]: rgba },
	};
	return commitDoc(state, nextDoc);
}

export function paletteEntries(
	state: SpriteEditorState,
	globalPalette: Record<string, RGBAQuad>,
	previews: DynamicPreviews,
): PaletteEntry[] {
	const entries: PaletteEntry[] = [];
	for (const [key, rgba] of Object.entries(state.doc.colors))
		entries.push({ key, rgba, label: key, kind: 'local' });
	for (const [key, rgba] of Object.entries(globalPalette)) {
		if (RESERVED_KEYS.has(key)) continue;
		entries.push({ key, rgba, label: key, kind: 'palette' });
	}
	entries.push({
		key: 'p',
		rgba: previews.p,
		label: 'player hue',
		kind: 'dynamic',
	});
	entries.push({
		key: 'a',
		rgba: previews.a,
		label: 'weapon accent',
		kind: 'dynamic',
	});
	return entries;
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

export function undoEdit(state: SpriteEditorState): SpriteEditorState {
	if (!canUndo(state.history)) return { ...state, feedback: '' };
	const history = undo(state.history);
	return {
		...state,
		history,
		doc: history.present,
		stroke: null,
		feedback: '',
	};
}

export function redoEdit(state: SpriteEditorState): SpriteEditorState {
	if (!canRedo(state.history)) return { ...state, feedback: '' };
	const history = redo(state.history);
	return {
		...state,
		history,
		doc: history.present,
		stroke: null,
		feedback: '',
	};
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export function saveResult(state: SpriteEditorState): {
	text: string;
	diagnostics: SpriteDiagnostic[];
} {
	const text = serializeSpriteFile(state.doc);
	// Round-trip check: the diagnostics the artist would see on reload.
	const { diagnostics } = parseSpriteFile(text, state.doc.id);
	return { text, diagnostics };
}

export { DEFAULT_KEY as SPRITE_DEFAULT_KEY };
