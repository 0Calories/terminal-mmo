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

export type SpriteTool = 'paint' | 'erase' | 'stamp' | 'anchor';

// The two places an anchor can live: at the document level (shared by every
// frame) or as a per-frame override on the current frame (ADR 0031).
export type AnchorScope = 'doc' | 'frame';

// Anchor + frame/pose names share the parser's identifier charset.
const NAME_RE = /^[A-Za-z0-9:_-]+$/;

// A selected background: a color key, or `null` for a transparent background.
export type BgSelection = string | null;

export interface SpriteEditorState {
	doc: SpriteDoc;
	// Name of the frame currently being edited.
	frame: string;
	// Name of the pose the current frame belongs to (drives playback + pose ops).
	pose: string;
	// Cursor in PIXEL coordinates (2× the cell resolution on each axis).
	cursor: { x: number; y: number };
	tool: SpriteTool;
	fgKey: string;
	bgKey: BgSelection;
	// The anchor name the anchor tool places, and whether at doc or frame scope.
	anchorName: string;
	anchorScope: AnchorScope;
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
		pose: poseContaining(doc, name) ?? name,
		cursor: { x: 0, y: 0 },
		tool: 'paint',
		fgKey: doc.key,
		bgKey: null,
		anchorName: firstAnchorName(doc),
		anchorScope: 'doc',
		feedback: '',
		history: initHistory(doc),
		stroke: null,
		strokeSeq: 0,
	};
}

// The pose whose frame list contains `frame`, if any (the parser also treats a
// frame referenced by no pose as its own implicit single-frame pose).
function poseContaining(doc: SpriteDoc, frame: string): string | undefined {
	for (const [pose, frames] of Object.entries(doc.poses))
		if (frames.includes(frame)) return pose;
	return undefined;
}

function firstAnchorName(doc: SpriteDoc): string {
	return Object.keys(doc.anchors)[0] ?? '';
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
	const pose = poseContaining(state.doc, name) ?? state.pose;
	return { ...state, frame: name, pose, stroke: null, feedback: '' };
}

// ---------------------------------------------------------------------------
// Poses — named ordered frame lists (ADR 0031). All mutations are undoable;
// illegal names / missing targets refuse with `feedback`.
// ---------------------------------------------------------------------------

export function poseNames(state: SpriteEditorState): string[] {
	return Object.keys(state.doc.poses);
}

export function poseFrames(state: SpriteEditorState, pose: string): string[] {
	return [...(state.doc.poses[pose] ?? [])];
}

// A fresh, fully-transparent frame sized to the current canvas so new frames
// line up with the art the artist is already drawing.
function newBlankFrame(state: SpriteEditorState, name: string): SpriteFrameDoc {
	const cur = state.doc.frames.find((f) => f.name === state.frame);
	const { w, h } = cur ? frameExtent(cur) : { w: 6, h: 4 };
	const rows = Array.from({ length: Math.max(1, h) }, () =>
		' '.repeat(Math.max(1, w)),
	);
	return { name, rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

// Create a named pose backed by one fresh blank frame of the same name; switch
// to it. Refuses illegal/duplicate names or a name colliding with a frame.
export function createPose(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	if (!NAME_RE.test(name))
		return refuse(
			state,
			`'${name}' is not a legal pose name (${NAME_RE.source})`,
		);
	if (name in state.doc.poses)
		return refuse(state, `pose '${name}' already exists`);
	if (state.doc.frames.some((f) => f.name === name))
		return refuse(state, `a frame named '${name}' already exists`);
	const frame = newBlankFrame(state, name);
	const nextDoc: SpriteDoc = {
		...state.doc,
		frames: [...state.doc.frames, frame],
		poses: { ...state.doc.poses, [name]: [name] },
	};
	const committed = commitDoc(state, nextDoc);
	return { ...committed, pose: name, frame: name };
}

// Append a fresh blank frame to an existing pose and select it. Without a name,
// one is derived (`<pose>-2`, `<pose>-3`, …) avoiding collisions.
export function addFrameToPose(
	state: SpriteEditorState,
	pose: string,
	frameName?: string,
): SpriteEditorState {
	const list = state.doc.poses[pose];
	if (list === undefined) return refuse(state, `no such pose '${pose}'`);
	const name = frameName ?? autoFrameName(state, pose);
	if (!NAME_RE.test(name))
		return refuse(state, `'${name}' is not a legal frame name`);
	if (state.doc.frames.some((f) => f.name === name))
		return refuse(state, `a frame named '${name}' already exists`);
	const frame = newBlankFrame(state, name);
	const nextDoc: SpriteDoc = {
		...state.doc,
		frames: [...state.doc.frames, frame],
		poses: { ...state.doc.poses, [pose]: [...list, name] },
	};
	const committed = commitDoc(state, nextDoc);
	return { ...committed, pose, frame: name };
}

function autoFrameName(state: SpriteEditorState, pose: string): string {
	for (let n = 2; ; n++) {
		const candidate = `${pose}-${n}`;
		if (!state.doc.frames.some((f) => f.name === candidate)) return candidate;
	}
}

// Delete a pose entry and garbage-collect any frame sections it orphaned (a
// frame referenced by no remaining pose is removed, so it does not silently
// become an implicit single-frame pose). Refuses removing the last pose.
export function deletePose(
	state: SpriteEditorState,
	pose: string,
): SpriteEditorState {
	if (!(pose in state.doc.poses))
		return refuse(state, `no such pose '${pose}'`);
	if (Object.keys(state.doc.poses).length <= 1)
		return refuse(state, 'cannot delete the last pose');
	const nextPoses: Record<string, readonly string[]> = {};
	for (const [name, frames] of Object.entries(state.doc.poses))
		if (name !== pose) nextPoses[name] = frames;
	const referenced = new Set(Object.values(nextPoses).flat());
	const nextFrames = state.doc.frames.filter((f) => referenced.has(f.name));
	const nextDoc: SpriteDoc = {
		...state.doc,
		poses: nextPoses,
		frames: nextFrames,
	};
	const committed = commitDoc(state, nextDoc);
	// Keep the cursor on a live pose/frame.
	if (nextPoses[state.pose] !== undefined) return committed;
	const nextPose = Object.keys(nextPoses)[0];
	return { ...committed, pose: nextPose, frame: nextPoses[nextPose][0] };
}

// Switch the current pose, landing on its first frame. Not a doc mutation, so
// it is not recorded in history.
export function selectPose(
	state: SpriteEditorState,
	pose: string,
): SpriteEditorState {
	const list = state.doc.poses[pose];
	if (list === undefined) return refuse(state, `no such pose '${pose}'`);
	return {
		...state,
		pose,
		frame: list[0] ?? state.frame,
		stroke: null,
		feedback: '',
	};
}

// Swap the frame at `index` with the one at `index + delta` within a pose.
export function reorderFrame(
	state: SpriteEditorState,
	pose: string,
	index: number,
	delta: number,
): SpriteEditorState {
	const list = state.doc.poses[pose];
	if (list === undefined) return refuse(state, `no such pose '${pose}'`);
	const to = index + delta;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length)
		return refuse(state, 'cannot move that frame — out of range');
	const next = [...list];
	[next[index], next[to]] = [next[to], next[index]];
	const nextDoc: SpriteDoc = {
		...state.doc,
		poses: { ...state.doc.poses, [pose]: next },
	};
	return commitDoc(state, nextDoc);
}

// Set (positive number) or clear (`null`/non-positive) a pose's playback fps.
// A cleared pose animates at the default EMOTE_FPS.
export function setPoseFps(
	state: SpriteEditorState,
	pose: string,
	fps: number | null,
): SpriteEditorState {
	if (!(pose in state.doc.poses))
		return refuse(state, `no such pose '${pose}'`);
	const nextFps: Record<string, number> = { ...state.doc.fps };
	if (fps === null) {
		delete nextFps[pose];
	} else if (!Number.isFinite(fps) || fps <= 0) {
		return refuse(state, 'fps must be a positive number');
	} else {
		nextFps[pose] = fps;
	}
	return commitDoc(state, { ...state.doc, fps: nextFps });
}

// ---------------------------------------------------------------------------
// Anchors — named cell coordinates, at doc scope or per-frame override. Anchors
// may legitimately sit outside the art grid (the parser warns, never blocks).
// ---------------------------------------------------------------------------

export interface AnchorMarker {
	name: string;
	x: number;
	y: number;
	// True when the position comes from a per-frame override, not the doc level.
	overridden: boolean;
}

// The effective anchors for the current frame: doc-level anchors overlaid with
// this frame's overrides (frame wins), each tagged with its source.
export function anchorMarkers(state: SpriteEditorState): AnchorMarker[] {
	const frame = currentFrame(state);
	const out = new Map<string, AnchorMarker>();
	for (const [name, a] of Object.entries(state.doc.anchors))
		out.set(name, { name, x: a.x, y: a.y, overridden: false });
	for (const [name, a] of Object.entries(frame.anchors))
		out.set(name, { name, x: a.x, y: a.y, overridden: true });
	return [...out.values()];
}

export function setAnchorName(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	if (!NAME_RE.test(name))
		return refuse(state, `'${name}' is not a legal anchor name`);
	return { ...state, anchorName: name, feedback: '' };
}

export function setAnchorScope(
	state: SpriteEditorState,
	scope: AnchorScope,
): SpriteEditorState {
	return { ...state, anchorScope: scope, feedback: '' };
}

// Place (or move) a named anchor at a cell. `scope` chooses doc level or a
// per-frame override on the current frame. Out-of-grid cells are allowed.
export function placeAnchor(
	state: SpriteEditorState,
	name: string,
	cellX: number,
	cellY: number,
	scope: AnchorScope,
): SpriteEditorState {
	if (!NAME_RE.test(name))
		return refuse(state, `'${name}' is not a legal anchor name`);
	if (cellX < 0 || cellY < 0)
		return refuse(state, 'an anchor cannot sit at a negative cell');
	if (scope === 'doc') {
		const nextDoc: SpriteDoc = {
			...state.doc,
			anchors: { ...state.doc.anchors, [name]: { x: cellX, y: cellY } },
		};
		return commitDoc(state, nextDoc);
	}
	const frame = currentFrame(state);
	const nextFrame: SpriteFrameDoc = {
		...frame,
		anchors: { ...frame.anchors, [name]: { x: cellX, y: cellY } },
	};
	return commitFrame(state, nextFrame);
}

// Remove a per-frame anchor override; the anchor falls back to its doc-level
// position. Refuses when the current frame has no override for that name.
export function removeAnchorOverride(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	const frame = currentFrame(state);
	if (!(name in frame.anchors))
		return refuse(state, `frame '${frame.name}' has no override for '${name}'`);
	const anchors = { ...frame.anchors };
	delete anchors[name];
	return commitFrame(state, { ...frame, anchors });
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
