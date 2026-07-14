// The Sprite editor's pure, headless state module (ADR 0031). Everything the
// forge `sprite edit` TUI needs to draw quadrant pixel art lives here as pure
// functions over an immutable state: a quadrant pixel canvas with the fg+bg
// expressibility rules, a glyph stamp Tool, a single active ink, undo/redo, and
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
// Never two colors *and* transparency; never three colors.
//
// Auto-resolve, never refuse (spec #387, rules #377). The artist picks a single
// active *ink* (a color key, or transparent), never an fg/bg pair. Every paint
// succeeds: the ink wins the touched Pixel and the cell coerces to the nearest
// legal state, reporting what it did on `feedback`. The three coercions:
//   • overpaint — a color ink into a one-color cell whose fg differs demotes the
//     old fg into the bg slot (the cell goes fully opaque, the touched Pixel the
//     lone new fg);
//   • recolor — a color ink into an already-opaque two-color cell recolors the
//     fg (no third color, no transparency to shed into);
//   • punch — transparent ink clears the touched Pixel and drops the bg
//     cell-wide, so the cell can never hold two colors plus a hole.
// The fg/bg split survives only as a half-block compilation detail of the
// `.sprite` grids; the artist never selects a bg.
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

// The single active ink (spec #387): a color key painting lit Pixels, or
// transparent. Transparent is a first-class ink (the `t` key / the right mouse
// button), not the absence of one — painting it punches Pixels out.
export type Ink =
	| { readonly kind: 'color'; readonly key: string }
	| { readonly kind: 'transparent' };

export const TRANSPARENT_INK: Ink = { kind: 'transparent' };

export function colorInk(key: string): Ink {
	return { kind: 'color', key };
}

// The color key an ink paints, or `null` when it is transparent.
export function inkColorKey(ink: Ink): string | null {
	return ink.kind === 'color' ? ink.key : null;
}

export function inkLabel(ink: Ink): string {
	return ink.kind === 'color' ? ink.key : 'transparent';
}

export interface SpriteEditorState {
	doc: SpriteDoc;
	// Name of the frame currently being edited.
	frame: string;
	// Name of the pose the current frame belongs to (drives playback + pose ops).
	pose: string;
	// Cursor in PIXEL coordinates (2× the cell resolution on each axis).
	cursor: { x: number; y: number };
	tool: SpriteTool;
	// The single active ink every paint uses (a color key, or transparent).
	ink: Ink;
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
		ink: colorInk(doc.key),
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

// Set the single active ink. A color ink must carry a usable key; transparent
// is always valid.
export function setInk(state: SpriteEditorState, ink: Ink): SpriteEditorState {
	if (ink.kind === 'color' && !validKey(ink.key))
		return refuse(state, `'${ink.key}' is not a usable color key`);
	return { ...state, ink, feedback: '' };
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
// Painting — auto-resolve, never refuse (spec #387, coercion rules #377)
// ---------------------------------------------------------------------------

// Commit a coerced cell write and attach the human-readable coercion note (''
// when the paint was a clean, non-coercing edit).
function commitPaint(
	state: SpriteEditorState,
	frame: SpriteFrameDoc,
	note: string,
): SpriteEditorState {
	const committed = commitFrame(state, frame, state.stroke ?? undefined);
	return note ? { ...committed, feedback: note } : committed;
}

// Write the touched cell as a quadrant cell (glyph derived from `mask`) and
// commit it with a coercion note. `fgKey`/`bgKey` are the raw keys, `''` for
// transparent; an empty mask forces a blank cell. Every coercion branch lands
// here, so the write+commit skeleton lives in one place.
function commitQuadrant(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
	mask: number,
	fgKey: string,
	bgKey: string,
	note: string,
): SpriteEditorState {
	const frame = writeCell(
		currentFrame(state),
		cellX,
		cellY,
		glyphFromQuadrants(mask),
		mask === 0 ? ' ' : fgKey,
		bgKey === '' ? ' ' : bgKey,
	);
	return commitPaint(state, frame, note);
}

// Paint one Pixel with an explicit ink, coercing the touched cell to the nearest
// legal state. This is the single paint primitive; `paintPixel` / `erasePixel`
// are the active-ink and transparent-ink spellings the TUI and input seam use.
export function paintWithInk(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	// Off-canvas to the top/left has no cell to coerce; clip with feedback rather
	// than grow into negative space (canvas growth is an explicit op, spec #379).
	if (px < 0 || py < 0)
		return refuse(state, 'clipped — nothing painted past the canvas edge');
	return ink.kind === 'transparent'
		? punchTransparent(state, px, py)
		: paintColor(state, px, py, ink.key);
}

// The active-ink paint (left button / `space`): whatever ink is selected.
export function paintPixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return paintWithInk(state, px, py, state.ink);
}

// The transparent-ink paint (right button / the eraser): always punches out,
// regardless of the selected ink.
export function erasePixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return paintWithInk(state, px, py, TRANSPARENT_INK);
}

// Paint a color ink into a cell, applying the overpaint/recolor coercions.
function paintColor(
	state: SpriteEditorState,
	px: number,
	py: number,
	key: string,
): SpriteEditorState {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	const t = 1 << bit;

	// A stamped (non-quadrant) cell has no sub-pixels to share: the ink wins the
	// touched Pixel by replacing the stamp with a one-Pixel quadrant cell.
	if (cell.mask === undefined)
		return commitQuadrant(
			state,
			cellX,
			cellY,
			t,
			key,
			'',
			`replaced stamp '${cell.glyph}'`,
		);

	const opaque = cell.bg !== '';
	const hasFg = cell.mask > 0;

	// Empty cell, or extending the same fg into transparent complement: the plain
	// one-color path — light the Pixel, keep the bg (transparent, or an existing
	// opaque bg when the same fg simply gains a Pixel).
	if (!hasFg || cell.fg === key) {
		const newMask = cell.mask | t;
		// A full fg mask leaves no complement, so any bg is invisible — drop it,
		// demoting the cell to one opaque colour.
		const dropBg = newMask === 15 && cell.bg !== '';
		const bg = dropBg ? '' : cell.bg;
		const note = dropBg ? `filled — background '${cell.bg}' dropped` : '';
		// No-op: the Pixel is already exactly this — don't grow history.
		if (
			glyphFromQuadrants(newMask) === cell.glyph &&
			key === cell.fg &&
			bg === cell.bg
		)
			return { ...state, feedback: '' };
		return commitQuadrant(state, cellX, cellY, newMask, key, bg, note);
	}

	// Opaque two-colour cell, different fg: recolour the fg (no third colour, no
	// transparency to shed into). All lit Pixels become the new ink; the touched
	// Pixel joins them; the bg colour is untouched — unless the Pixel completes
	// the mask, when the bg loses its complement and drops.
	if (opaque) {
		const newMask = cell.mask | t;
		const bg = newMask === 15 ? '' : cell.bg;
		const note =
			newMask === 15
				? `recoloured foreground → '${key}', background '${cell.bg}' dropped`
				: `recoloured foreground '${cell.fg}' → '${key}'`;
		return commitQuadrant(state, cellX, cellY, newMask, key, bg, note);
	}

	// One-colour + transparent cell, different fg: overpaint. The ink wins the
	// touched Pixel as the lone fg; the old fg demotes into the bg slot, filling
	// the complement, so the cell goes fully opaque.
	return commitQuadrant(
		state,
		cellX,
		cellY,
		t,
		key,
		cell.fg,
		`overpainted '${cell.fg}' → background`,
	);
}

// Paint transparent ink: clear the touched Pixel and punch any bg out cell-wide,
// so a cell can never end up two colours plus a hole.
function punchTransparent(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);

	// Transparent ink clears a stamped cell whole (rule #377).
	if (cell.mask === undefined)
		return commitQuadrant(
			state,
			cellX,
			cellY,
			0,
			'',
			'',
			`cleared stamp '${cell.glyph}'`,
		);

	const t = 1 << bit;
	const pixelAlreadyClear = (cell.mask & t) === 0;
	// Nothing to do: the Pixel is already off and there is no bg to punch.
	if (pixelAlreadyClear && cell.bg === '') return { ...state, feedback: '' };

	const newMask = cell.mask & ~t;
	const note = cell.bg !== '' ? `punched background '${cell.bg}'` : '';
	return commitQuadrant(state, cellX, cellY, newMask, cell.fg, '', note);
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
	// A stamp needs a colour; when the active ink is transparent fall back to the
	// doc default key so the glyph is still visible.
	const fgChar = inkColorKey(state.ink) ?? state.doc.key;
	const frame = writeCell(currentFrame(state), cellX, cellY, char, fgChar, ' ');
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
