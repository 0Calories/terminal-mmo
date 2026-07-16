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
import type { RGBAQuad } from '@mmo/core/entities';
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

export type SpriteTool =
	| 'paint'
	| 'erase'
	| 'fill'
	| 'stamp'
	| 'anchor'
	| 'line'
	| 'rect'
	| 'ellipse'
	| 'select'
	| 'move'
	// `paste` is a rail/number-row TRIGGER, not a resting mode: selecting it spawns
	// a paste float and drops the artist into `move` to place it (spec #400). It is
	// never stored as `state.tool`.
	| 'paste';

// The three anchor-style geometry tools (spec #387, #394): they place an anchor
// Pixel, drag/step a live preview to a second Pixel, and commit one rasterized
// shape as a single undo step. The `select` tool (spec #387, #399) shares the
// same pending-anchor grammar — it drops an anchor, drags a marquee, and commits
// a rectangular selection instead of paint — so it rides the same `PendingShape`
// state and the same start/move/commit/toggle/cancel transitions.
export const SHAPE_TOOLS = ['line', 'rect', 'ellipse'] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];

// Every tool that drives the shared pending-anchor gesture: the geometry shapes,
// plus `select`. They differ only in what the commit produces (paint vs a
// selection rectangle), never in the gesture grammar.
export type AnchorTool = ShapeTool | 'select';

export function isShapeTool(tool: SpriteTool): tool is ShapeTool {
	return (SHAPE_TOOLS as readonly string[]).includes(tool);
}

// Rect and ellipse each carry a per-tool draw mode (spec #387): an outline ring
// on the bounding box, or a filled solid. `o` toggles the active tool's mode.
export type ShapeMode = 'outline' | 'filled';

// A Pixel coordinate — the atomic unit of every shape's rasterization.
export interface Point {
	readonly x: number;
	readonly y: number;
}

// The one shared pending-shape anchor state both devices drive (spec #387): the
// anchor Pixel, the live endpoint, whether shift is constraining it to a visual
// square/circle, and the ink the eventual commit paints (active ink, or
// transparent for the right button). `null` between gestures.
export interface PendingShape {
	readonly tool: AnchorTool;
	readonly anchor: Point;
	readonly to: Point;
	readonly constrain: boolean;
	readonly ink: Ink;
}

// A rectangular, Pixel-granularity selection (spec #387, #399): inclusive Pixel
// bounds a `select` gesture committed. `null` when nothing is selected.
export interface Selection {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

// One lifted foreground Pixel carried by a float — its SOURCE Pixel position (the
// current offset is applied on landing) and the resolved colour key it paints.
export interface FloatPixel {
	readonly x: number;
	readonly y: number;
	readonly key: string;
}

// One Glyph stamp riding a float as an atomic passenger (spec #387, #399): its
// SOURCE cell, the glyph, and its colour key. It travels only when its cell was
// fully enclosed by the selection; on landing it rounds to the nearest cell.
export interface FloatStamp {
	readonly cellX: number;
	readonly cellY: number;
	readonly glyph: string;
	readonly fg: string;
}

// A FLOATING move in flight (spec #387, #399). The selected art has been lifted
// off the canvas: `pixels`/`stamps` are the lifted content at their source
// positions, `source` is the rectangle they came from (shown transparent while
// the float lives), `grab` is the Pixel a mouse drag grabbed, and `dx`/`dy` is
// the current Pixel offset. Nothing is committed until drop/Enter; Esc drops the
// float and the art returns exactly as it was.
export interface Float {
	readonly pixels: readonly FloatPixel[];
	readonly stamps: readonly FloatStamp[];
	readonly source: Selection;
	readonly grab: Point;
	readonly dx: number;
	readonly dy: number;
	// Whether this float LIFTED its content off the canvas (a move) or carries
	// clipboard content that was never on this canvas (a paste). `undefined`/`true`
	// means lifted: the source shows transparent and clears on drop. `false` means
	// a paste — nothing is cleared, so pasting never erases the art it lands over.
	readonly lifted?: boolean;
}

// The single in-editor clipboard buffer (spec #387, #400): the foreground Pixels
// and fully-enclosed Glyph stamps a copy/cut captured, at their SOURCE positions,
// plus the rectangle they came from. Editor-session-scoped — it survives Frame
// and Pose switches (state is threaded through those) but is never persisted to
// disk. A paste spawns a float from it at the source coordinates.
export interface Clipboard {
	readonly pixels: readonly FloatPixel[];
	readonly stamps: readonly FloatStamp[];
	readonly source: Selection;
}

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

// Whether two inks denote the same paint (a color key, or transparent). Used to
// mark the active swatch and to locate the ink in the rail order for nudging.
export function inkEquals(a: Ink, b: Ink): boolean {
	if (a.kind === 'transparent') return b.kind === 'transparent';
	return b.kind === 'color' && a.key === b.key;
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
	// The in-flight geometry shape (line/rect/ellipse) both devices drive, or null
	// between gestures (spec #387, #394).
	shape: PendingShape | null;
	// Per-tool outline↔filled mode for the rect and ellipse tools.
	rectMode: ShapeMode;
	ellipseMode: ShapeMode;
	// The last Pixel the pencil painted, so a shift-click strokes a line from it
	// (spec #387). null until the pencil has painted since the last reset.
	lastPaint: Point | null;
	// The committed rectangular selection (spec #387, #399), or null.
	selection: Selection | null;
	// The floating move in flight, or null between lift and drop (spec #399).
	float: Float | null;
	// The in-editor clipboard buffer (spec #400), or null when nothing is copied.
	// Survives Frame/Pose switches; never persisted to disk.
	clipboard: Clipboard | null;
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
		shape: null,
		rectMode: 'outline',
		ellipseMode: 'outline',
		lastPaint: null,
		selection: null,
		float: null,
		clipboard: null,
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
	// Canvas growth is an explicit op (spec #387, #399): a paint that lands past
	// ANY edge clips with feedback rather than auto-growing the Frame. This is the
	// one seam the pencil, shift-lines, fills, shape commits, and float drops all
	// pass through, so removing the grow here removes paint-past-the-edge grow for
	// every tool at once.
	const { w, h } = frameExtent(currentFrame(state));
	if (px < 0 || py < 0 || px >= w * 2 || py >= h * 2)
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
// Flood fill (spec #387, rules #377)
// ---------------------------------------------------------------------------

// What a Pixel visually *shows* — the key fill's "same displayed key" test reads,
// never raw storage. A lit Pixel shows its cell's fg key; an unlit Pixel shows the
// bg key when the cell is opaque, or transparent ('') when it is not. A glyph-
// stamped cell has no sub-Pixels: it is a wall the fill can neither enter nor cross.
type PixelClass =
	| { readonly wall: true }
	| { readonly wall: false; readonly key: string };

function pixelClass(
	state: SpriteEditorState,
	px: number,
	py: number,
): PixelClass {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined) return { wall: true };
	const lit = (cell.mask & (1 << bit)) !== 0;
	return { wall: false, key: lit ? cell.fg : cell.bg };
}

// Repaint (or clear) a fill region as one undo step. Region Pixels resolve through
// the standard paint coercion; for transparent ink the border stamps clear too.
// Nothing changed ⇒ no history entry and empty feedback (like a no-op paint).
function applyFill(
	state: SpriteEditorState,
	region: readonly { x: number; y: number }[],
	stampCells: ReadonlySet<string>,
	ink: Ink,
): SpriteEditorState {
	// A stable order keeps coercion deterministic regardless of the flood's walk.
	const pixels = [...region].sort((a, b) => a.y - b.y || a.x - b.x);
	let s = beginStroke(state);
	for (const { x, y } of pixels) s = paintWithInk(s, x, y, ink);
	// Colour ink already skipped stamps by never queuing them; transparent ink
	// clears each border stamp (any of its Pixels punches the whole cell).
	if (ink.kind === 'transparent')
		for (const id of stampCells) {
			const [cx, cy] = id.split(',').map(Number);
			s = paintWithInk(s, cx * 2, cy * 2, ink);
		}
	s = endStroke(s);
	if (s.doc === state.doc) return { ...s, feedback: '' };
	const parts: string[] = [];
	if (pixels.length > 0)
		parts.push(
			`filled ${pixels.length} Pixel${pixels.length === 1 ? '' : 's'}`,
		);
	const stamps = ink.kind === 'transparent' ? stampCells.size : 0;
	if (stamps > 0)
		parts.push(`cleared ${stamps} stamp${stamps === 1 ? '' : 's'}`);
	return { ...s, feedback: parts.join(', ') };
}

// Flood fill from a seed Pixel: recolour (or clear) every 4-connected Pixel that
// shows the seed's displayed key, bounded to the current Frame. Glyph stamps are
// walls — the region never spreads through one; colour ink leaves border stamps
// untouched, transparent ink clears them. The whole fill is exactly one undo step.
export function floodFill(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	const pw = w * 2;
	const ph = h * 2;
	if (px < 0 || py < 0 || px >= pw || py >= ph)
		return refuse(state, 'clipped — nothing to fill past the canvas edge');

	const cellId = (cx: number, cy: number) => `${cx},${cy}`;
	const seed = pixelClass(state, px, py);

	// Seeding on a stamp: it is a wall with no Pixel region to flood. Colour ink
	// skips it entirely; transparent ink clears just that one stamp.
	if (seed.wall) {
		if (ink.kind !== 'transparent')
			return refuse(state, 'fill skipped the glyph stamp');
		const { cellX, cellY } = pixelToCell(px, py);
		return applyFill(state, [], new Set([cellId(cellX, cellY)]), ink);
	}

	const target = seed.key;
	const visited = new Set<string>([`${px},${py}`]);
	const region: { x: number; y: number }[] = [];
	const stampCells = new Set<string>();
	const stack: { x: number; y: number }[] = [{ x: px, y: py }];
	while (stack.length > 0) {
		const p = stack.pop() as { x: number; y: number };
		region.push(p);
		for (const [nx, ny] of [
			[p.x - 1, p.y],
			[p.x + 1, p.y],
			[p.x, p.y - 1],
			[p.x, p.y + 1],
		] as const) {
			if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) continue;
			const id = `${nx},${ny}`;
			if (visited.has(id)) continue;
			visited.add(id);
			const cls = pixelClass(state, nx, ny);
			if (cls.wall) {
				// A stamp bounds the flood; note its cell for transparent-ink clearing.
				const { cellX, cellY } = pixelToCell(nx, ny);
				stampCells.add(cellId(cellX, cellY));
				continue;
			}
			if (cls.key === target) stack.push({ x: nx, y: ny });
		}
	}
	return applyFill(state, region, stampCells, ink);
}

// ---------------------------------------------------------------------------
// Geometry shapes — line / rect / ellipse (spec #387, #394)
//
// Every shape rasterizes to a set of Pixels on a corner-to-corner bounding box,
// then commits as a batch of ordinary Pixel paints resolved by the same coercion
// rules as the pencil — one shape is exactly one undo step. Out-of-bounds Pixels
// clip (no auto-grow); the artist never reasons about cells to draw geometry.
// ---------------------------------------------------------------------------

// The Pixels a straight line between two Pixels lights (integer Bresenham).
export function linePixels(a: Point, b: Point): Point[] {
	let x0 = a.x;
	let y0 = a.y;
	const dx = Math.abs(b.x - x0);
	const dy = -Math.abs(b.y - y0);
	const sx = x0 < b.x ? 1 : -1;
	const sy = y0 < b.y ? 1 : -1;
	let err = dx + dy;
	const out: Point[] = [];
	while (true) {
		out.push({ x: x0, y: y0 });
		if (x0 === b.x && y0 === b.y) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
	return out;
}

function bbox(
	a: Point,
	b: Point,
): { x0: number; y0: number; x1: number; y1: number } {
	return {
		x0: Math.min(a.x, b.x),
		y0: Math.min(a.y, b.y),
		x1: Math.max(a.x, b.x),
		y1: Math.max(a.y, b.y),
	};
}

// The Pixels of an axis-aligned rectangle on the bounding box — the four edges
// (`outline`) or every enclosed Pixel (`filled`).
export function rectPixels(a: Point, b: Point, filled: boolean): Point[] {
	const { x0, y0, x1, y1 } = bbox(a, b);
	const out: Point[] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const edge = x === x0 || x === x1 || y === y0 || y === y1;
			if (filled || edge) out.push({ x, y });
		}
	return out;
}

// The Pixels of an ellipse inscribed in the bounding box — the boundary ring
// (`outline`) or the solid disc (`filled`). A Pixel is inside when its centre
// lies within the normalized ellipse; the ring is inside Pixels touching an
// outside neighbour. Small boxes degrade gracefully (a 3×3 box is a diamond, a
// zero-width box a straight segment).
export function ellipsePixels(a: Point, b: Point, filled: boolean): Point[] {
	const { x0, y0, x1, y1 } = bbox(a, b);
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const rx = (x1 - x0) / 2;
	const ry = (y1 - y0) / 2;
	// A collapsed axis has no area to inscribe — the shape is the segment itself.
	if (rx === 0 || ry === 0) return rectPixels(a, b, true);
	const inside = (x: number, y: number): boolean =>
		((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + 1e-9;
	const out: Point[] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			if (!inside(x, y)) continue;
			if (filled) {
				out.push({ x, y });
				continue;
			}
			// A boundary Pixel has at least one 4-neighbour outside the disc.
			if (
				!inside(x - 1, y) ||
				!inside(x + 1, y) ||
				!inside(x, y - 1) ||
				!inside(x, y + 1)
			)
				out.push({ x, y });
		}
	return out;
}

// Snap `to` so the bounding box is a VISUAL square/circle (spec #387): a Pixel's
// native aspect is 1:2 (half a cell each axis, and a cell is twice as tall as
// wide), so equal on-screen extent means width = 2×height in Pixels. The larger
// visual side governs; the sign of each axis is preserved.
export function constrainSquare(anchor: Point, to: Point): Point {
	const dx = to.x - anchor.x;
	const dy = to.y - anchor.y;
	const sx = dx < 0 ? -1 : 1;
	const sy = dy < 0 ? -1 : 1;
	const h = Math.max(Math.abs(dy), Math.round(Math.abs(dx) / 2));
	return { x: anchor.x + sx * 2 * h, y: anchor.y + sy * h };
}

function shapeMode(state: SpriteEditorState, tool: ShapeTool): ShapeMode {
	if (tool === 'rect') return state.rectMode;
	if (tool === 'ellipse') return state.ellipseMode;
	return 'outline';
}

// The raw Pixels a shape would paint, before clipping — resolves the tool, the
// shift constraint, and the per-tool fill mode.
function rasterShape(
	tool: ShapeTool,
	anchor: Point,
	to: Point,
	filled: boolean,
): Point[] {
	if (tool === 'line') return linePixels(anchor, to);
	if (tool === 'rect') return rectPixels(anchor, to, filled);
	return ellipsePixels(anchor, to, filled);
}

// The Pixels the pending shape resolves to, split into those inside the current
// Frame (paintable) and a count clipped past its edges (spec #394: no auto-grow).
function resolveShape(state: SpriteEditorState): {
	inside: Point[];
	clipped: number;
} {
	const shape = state.shape;
	if (!shape) return { inside: [], clipped: 0 };
	const to = shape.constrain
		? constrainSquare(shape.anchor, shape.to)
		: shape.to;
	// The `select` marquee previews as a hollow rectangle on the same bbox the
	// geometry tools use; it never rasterizes a fill.
	const raw =
		shape.tool === 'select'
			? rectPixels(shape.anchor, to, false)
			: rasterShape(
					shape.tool,
					shape.anchor,
					to,
					shapeMode(state, shape.tool) === 'filled',
				);
	const { w, h } = frameExtent(currentFrame(state));
	const maxX = w * 2;
	const maxY = h * 2;
	const inside = raw.filter(
		(p) => p.x >= 0 && p.y >= 0 && p.x < maxX && p.y < maxY,
	);
	return { inside, clipped: raw.length - inside.length };
}

// Paint a batch of Pixels with one ink, coalesced under a single tag so the
// whole batch is one undo step. No-op Pixels grow no history (the primitive
// already skips them). Used for shape commits and pencil shift-lines.
function paintBatch(
	state: SpriteEditorState,
	pixels: readonly Point[],
	ink: Ink,
): SpriteEditorState {
	const tag = state.stroke ?? `shape${state.strokeSeq + 1}`;
	let s: SpriteEditorState = { ...state, stroke: tag };
	for (const p of pixels) s = paintWithInk(s, p.x, p.y, ink);
	return {
		...s,
		stroke: state.stroke,
		strokeSeq: state.stroke ? state.strokeSeq : state.strokeSeq + 1,
	};
}

// Begin a shape: drop the anchor Pixel and start a live preview collapsed onto
// it. `ink` is the commit's ink (active, or transparent for the right button).
export function beginShape(
	state: SpriteEditorState,
	tool: AnchorTool,
	px: number,
	py: number,
	ink: Ink,
	constrain = false,
): SpriteEditorState {
	const anchor = { x: px, y: py };
	return {
		...state,
		cursor: { x: Math.max(0, px), y: Math.max(0, py) },
		shape: { tool, anchor, to: anchor, constrain, ink },
		feedback: '',
	};
}

// Drag/step the pending shape's endpoint (and its shift constraint) for preview.
// A no-op when no shape is pending.
export function updateShape(
	state: SpriteEditorState,
	px: number,
	py: number,
	constrain = false,
): SpriteEditorState {
	if (!state.shape) return state;
	return {
		...state,
		cursor: { x: Math.max(0, px), y: Math.max(0, py) },
		shape: { ...state.shape, to: { x: px, y: py }, constrain },
	};
}

// The Pixels the pending shape would light right now, in Frame bounds — what the
// TUI draws as the live preview. Empty when nothing is pending.
export function shapePreviewPixels(state: SpriteEditorState): Point[] {
	return resolveShape(state).inside;
}

// Commit the pending shape: rasterize it, paint every in-bounds Pixel through
// the standard coercion rules as one undo step, and clear the pending state.
// Clipped Pixels are reported on the status line.
export function commitShape(state: SpriteEditorState): SpriteEditorState {
	if (!state.shape) return state;
	const ink = state.shape.ink;
	const { inside, clipped } = resolveShape(state);
	const cleared: SpriteEditorState = { ...state, shape: null };
	const painted = paintBatch(cleared, inside, ink);
	const note = clipped > 0 ? `clipped ${clipped} px past the canvas edge` : '';
	return { ...painted, feedback: note };
}

// Abandon the pending shape losslessly (esc / right-click-away).
export function cancelShape(state: SpriteEditorState): SpriteEditorState {
	if (!state.shape) return state;
	return { ...state, shape: null, feedback: '' };
}

// Toggle the active tool's outline↔filled mode (spec #387: `o`). Line has no fill
// mode; the call reports that rather than silently doing nothing.
export function toggleShapeMode(state: SpriteEditorState): SpriteEditorState {
	if (state.tool === 'rect')
		return {
			...state,
			rectMode: state.rectMode === 'outline' ? 'filled' : 'outline',
			feedback: '',
		};
	if (state.tool === 'ellipse')
		return {
			...state,
			ellipseMode: state.ellipseMode === 'outline' ? 'filled' : 'outline',
			feedback: '',
		};
	return { ...state, feedback: 'the line tool has no fill mode' };
}

// Stroke a straight line of the given ink from the pencil's last painted Pixel to
// (px, py) as one undo step (spec #387: shift-click pencil). With no prior point
// it paints just the endpoint. Either way (px, py) becomes the new last point.
export function pencilLineTo(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	const from = state.lastPaint;
	const pixels = from ? linePixels(from, { x: px, y: py }) : [{ x: px, y: py }];
	const painted = paintBatch(state, pixels, ink);
	return { ...painted, lastPaint: { x: px, y: py } };
}

// ---------------------------------------------------------------------------
// Selection & floating move (spec #387, #399)
//
// A rectangular, Pixel-granularity selection is gestured as an anchor tool (the
// shared PendingShape grammar). Dragging it (mouse) or nudging it (keyboard)
// LIFTS the selected foreground Pixels into a float: the source shows transparent
// and the float rides live at intermediate offsets, committing lift+drop as ONE
// undo step; Esc cancels losslessly. Transparent Pixels of the float SKIP on
// landing (only lit Pixels were lifted); a drop is a batch of Pixel paints
// resolved by the standard coercion rules — out-of-bounds portions clip. Glyph
// stamps travel as atomic passengers only when their cell is fully enclosed, and
// land on the nearest cell (the Pixel offset rounds to the cell grid).
// ---------------------------------------------------------------------------

// Clamp two Pixels into an inclusive selection rectangle within the Frame.
export function makeSelection(
	state: SpriteEditorState,
	a: Point,
	b: Point,
): Selection {
	const { w, h } = frameExtent(currentFrame(state));
	const clampX = (v: number) =>
		Math.max(0, Math.min(Math.max(0, w * 2 - 1), v));
	const clampY = (v: number) =>
		Math.max(0, Math.min(Math.max(0, h * 2 - 1), v));
	return {
		x0: clampX(Math.min(a.x, b.x)),
		y0: clampY(Math.min(a.y, b.y)),
		x1: clampX(Math.max(a.x, b.x)),
		y1: clampY(Math.max(a.y, b.y)),
	};
}

export function setSelection(
	state: SpriteEditorState,
	sel: Selection | null,
): SpriteEditorState {
	return { ...state, selection: sel, feedback: '' };
}

// The whole current Frame as a selection (spec #399: whole-Frame shift =
// select-all + float, no new machinery).
export function selectAll(state: SpriteEditorState): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	if (w === 0 || h === 0) return { ...state, selection: null };
	return {
		...state,
		selection: { x0: 0, y0: 0, x1: w * 2 - 1, y1: h * 2 - 1 },
		feedback: '',
	};
}

// Drop the committed selection (a live float owns it, so this is inert then).
export function clearSelection(state: SpriteEditorState): SpriteEditorState {
	if (state.float) return state;
	return { ...state, selection: null, feedback: '' };
}

// Commit the pending `select` gesture into a committed selection rectangle. A
// no-op for any other pending anchor (the geometry tools commit through
// commitShape).
export function commitSelection(state: SpriteEditorState): SpriteEditorState {
	const shape = state.shape;
	if (shape?.tool !== 'select') return state;
	const selection = makeSelection(state, shape.anchor, shape.to);
	return { ...state, shape: null, selection, feedback: '' };
}

export function selectionContains(
	sel: Selection,
	px: number,
	py: number,
): boolean {
	return px >= sel.x0 && px <= sel.x1 && py >= sel.y0 && py <= sel.y1;
}

// The selection rectangle the canvas draws as a marquee: the float's rectangle at
// its live offset while a float rides, else the committed selection.
export function selectionOverlay(state: SpriteEditorState): Selection | null {
	const f = state.float;
	if (f)
		return {
			x0: f.source.x0 + f.dx,
			y0: f.source.y0 + f.dy,
			x1: f.source.x1 + f.dx,
			y1: f.source.y1 + f.dy,
		};
	return state.selection;
}

// Capture the foreground Pixels and fully-enclosed Glyph stamps a selection would
// lift. Only lit Pixels are captured (transparent/complement quadrants skip); a
// stamp travels iff every one of its cell's Pixels lies inside the selection.
function liftContent(
	state: SpriteEditorState,
	sel: Selection,
): { pixels: FloatPixel[]; stamps: FloatStamp[] } {
	const pixels: FloatPixel[] = [];
	for (let y = sel.y0; y <= sel.y1; y++)
		for (let x = sel.x0; x <= sel.x1; x++) {
			const { cellX, cellY, bit } = pixelToCell(x, y);
			const cell = cellAt(state, cellX, cellY);
			if (cell.mask === undefined) continue; // stamp cell — no sub-Pixels
			if ((cell.mask & (1 << bit)) === 0) continue; // unlit → skip
			const key =
				cell.fg === SENTINEL || cell.fg === '' ? state.doc.key : cell.fg;
			pixels.push({ x, y, key });
		}
	const stamps: FloatStamp[] = [];
	const { w, h } = frameExtent(currentFrame(state));
	for (let cy = Math.floor(sel.y0 / 2); cy <= Math.floor(sel.y1 / 2); cy++)
		for (let cx = Math.floor(sel.x0 / 2); cx <= Math.floor(sel.x1 / 2); cx++) {
			if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
			// Fully enclosed: both Pixel columns and rows of the cell are inside.
			if (2 * cx < sel.x0 || 2 * cx + 1 > sel.x1) continue;
			if (2 * cy < sel.y0 || 2 * cy + 1 > sel.y1) continue;
			const cell = cellAt(state, cx, cy);
			if (cell.mask !== undefined || cell.glyph === ' ') continue; // stamps only
			const fg = cell.fg === '' ? state.doc.key : cell.fg;
			stamps.push({ cellX: cx, cellY: cy, glyph: cell.glyph, fg });
		}
	return { pixels, stamps };
}

// Lift the current selection into a float (spec #399). The source stays visually
// transparent (via floatDisplayDoc) until the drop commits, so the lift records
// no history of its own. `grab` is the Pixel a mouse drag grabbed.
export function beginFloat(
	state: SpriteEditorState,
	grab?: Point,
): SpriteEditorState {
	if (state.float) return state;
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to move first');
	const { pixels, stamps } = liftContent(state, sel);
	return {
		...state,
		float: {
			pixels,
			stamps,
			source: sel,
			grab: grab ?? { x: sel.x0, y: sel.y0 },
			dx: 0,
			dy: 0,
		},
		feedback: '',
	};
}

// Set the float's absolute offset from where a mouse drag grabbed it.
export function moveFloatTo(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	if (!state.float) return state;
	return {
		...state,
		float: {
			...state.float,
			dx: px - state.float.grab.x,
			dy: py - state.float.grab.y,
		},
	};
}

// Nudge the float by a Pixel delta (keyboard arrows / whole-Frame shift). Lifts
// the current selection into a float first when none is riding yet.
export function nudgeFloat(
	state: SpriteEditorState,
	dx: number,
	dy: number,
): SpriteEditorState {
	let s = state;
	if (!s.float) {
		s = beginFloat(s);
		if (!s.float) return s; // no selection to lift
	}
	return {
		...s,
		float: { ...s.float, dx: s.float.dx + dx, dy: s.float.dy + dy },
		feedback: '',
	};
}

// Bake a float into a fresh doc: clear the source (transparent), then land the
// lifted content at its offset through the standard paint coercion, clipping
// out-of-bounds Pixels/stamps. Returns the doc and the clipped count. Used both
// for the live display composite and — recorded once — for the drop commit.
function bakeFloat(state: SpriteEditorState): {
	doc: SpriteDoc;
	clipped: number;
} {
	const float = state.float;
	if (!float) return { doc: state.doc, clipped: 0 };
	const { w, h } = frameExtent(currentFrame(state));
	let s: SpriteEditorState = state;
	// 1. Clear the source — but only for a lifted move. A paste float (lifted ===
	//    false) carries clipboard content that was never on this canvas, so it
	//    never clears anything: pasting only ever adds art, never erases it. Only
	//    lifted Pixels/enclosed stamps are cleared, so a partially-covered stamp
	//    (never lifted) is left exactly as it was.
	if (float.lifted !== false) {
		for (const p of float.pixels) s = punchTransparent(s, p.x, p.y);
		for (const st of float.stamps)
			s = commitQuadrant(s, st.cellX, st.cellY, 0, '', '', '');
	}
	// 2. Land the float; out-of-bounds portions clip.
	let clipped = 0;
	for (const p of float.pixels) {
		const lx = p.x + float.dx;
		const ly = p.y + float.dy;
		if (lx < 0 || ly < 0 || lx >= w * 2 || ly >= h * 2) {
			clipped++;
			continue;
		}
		s = paintColor(s, lx, ly, p.key);
	}
	for (const st of float.stamps) {
		const cx = st.cellX + Math.round(float.dx / 2);
		const cy = st.cellY + Math.round(float.dy / 2);
		if (cx < 0 || cy < 0 || cx >= w || cy >= h) {
			clipped++;
			continue;
		}
		// A landed stamp owns its whole destination cell.
		s = commitFrame(
			s,
			writeCell(currentFrame(s), cx, cy, st.glyph, st.fg, ' '),
		);
	}
	return { doc: s.doc, clipped };
}

// The doc the canvas + Composited preview render while a float rides: the source
// hole plus the float at its live offset, exactly as a drop would commit it.
export function floatDisplayDoc(state: SpriteEditorState): SpriteDoc {
	if (!state.float) return state.doc;
	return bakeFloat(state).doc;
}

// Drop the float: bake lift+drop into the doc as ONE undo step, land the
// selection on the moved rectangle, and report any clip. A zero-offset drop
// (a click without a drag) makes no change and records nothing.
export function commitFloat(state: SpriteEditorState): SpriteEditorState {
	const float = state.float;
	if (!float) return state;
	// A zero-offset move drop is a no-op (the art returns to where it was lifted),
	// but a zero-offset PASTE drop still lands its clipboard content at the source
	// — the content is new, not a move returning to origin.
	if (float.dx === 0 && float.dy === 0 && float.lifted !== false)
		return { ...state, float: null, selection: float.source, feedback: '' };
	const { doc, clipped } = bakeFloat(state);
	const landed = makeSelection(
		state,
		{ x: float.source.x0 + float.dx, y: float.source.y0 + float.dy },
		{ x: float.source.x1 + float.dx, y: float.source.y1 + float.dy },
	);
	const tag = `float${state.strokeSeq + 1}`;
	return {
		...state,
		doc,
		history: record(state.history, doc, tag),
		strokeSeq: state.strokeSeq + 1,
		float: null,
		selection: landed,
		feedback: clipped > 0 ? `clipped ${clipped} past the canvas edge` : '',
	};
}

// Cancel the float losslessly (Esc): drop it with the art untouched, keeping the
// selection where it was lifted from. No doc/history change.
export function cancelFloat(state: SpriteEditorState): SpriteEditorState {
	if (!state.float) return state;
	return { ...state, float: null, feedback: '' };
}

// Clear the selection's contents (delete/backspace) as one undo step: erase the
// selected foreground Pixels and fully-enclosed stamps, keeping the selection.
export function deleteSelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'nothing selected to delete');
	const { pixels, stamps } = liftContent(state, sel);
	if (pixels.length === 0 && stamps.length === 0)
		return { ...state, feedback: '' };
	let s: SpriteEditorState = state;
	for (const p of pixels) s = punchTransparent(s, p.x, p.y);
	for (const st of stamps)
		s = commitQuadrant(s, st.cellX, st.cellY, 0, '', '', '');
	const tag = `delete${state.strokeSeq + 1}`;
	return {
		...state,
		doc: s.doc,
		history: record(state.history, s.doc, tag),
		strokeSeq: state.strokeSeq + 1,
		feedback: 'cleared selection',
	};
}

// ---------------------------------------------------------------------------
// Clipboard — copy / cut / paste (spec #387, #400)
//
// The clipboard is a single in-editor buffer surviving Frame/Pose switches (it
// rides SpriteEditorState, threaded through every switch) and is never persisted
// to disk. Copy is a PURE READ — it captures the selection's lit Pixels and
// fully-enclosed Glyph stamps and records no undo step. Cut = copy + clear as one
// step; delete = clear as one step (deleteSelection above). Paste SPAWNS A FLOAT
// at the source coordinates via the #399 float machinery (marked lifted=false so
// it clears nothing), always valid under whole-file sizing — so cross-Frame
// pastes arrive aligned for animation work.
// ---------------------------------------------------------------------------

// Copy the selection into the clipboard. A pure read: no doc or history change.
// Only lit Pixels and fully-enclosed stamps are captured (the same rule the float
// lift uses), so a copy travels exactly what a move would.
export function copySelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to copy first');
	const { pixels, stamps } = liftContent(state, sel);
	return {
		...state,
		clipboard: { pixels, stamps, source: sel },
		feedback: 'copied selection',
	};
}

// Cut = copy + clear as exactly ONE undo step. The copy is free (no history);
// the clear records the single step deleteSelection would, so a cut retreats in
// one undo. The selection survives for a follow-up paste.
export function cutSelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to cut first');
	const { pixels, stamps } = liftContent(state, sel);
	const copied: SpriteEditorState = {
		...state,
		clipboard: { pixels, stamps, source: sel },
	};
	return { ...deleteSelection(copied), feedback: 'cut selection' };
}

// Paste: spawn a float from the clipboard at the SOURCE coordinates (spec #400).
// The float is a paste (lifted=false), so it clears nothing and behaves like a
// move float otherwise — drag/arrows place it, Enter/drop commits through the
// standard coercion with clipping, Esc cancels. A live float is left alone (the
// TUI commits it before pasting).
export function pasteFromClipboard(
	state: SpriteEditorState,
): SpriteEditorState {
	if (state.float) return state;
	const clip = state.clipboard;
	if (!clip) return refuse(state, 'clipboard is empty — copy or cut first');
	return {
		...state,
		selection: clip.source,
		float: {
			pixels: clip.pixels,
			stamps: clip.stamps,
			source: clip.source,
			grab: { x: clip.source.x0, y: clip.source.y0 },
			dx: 0,
			dy: 0,
			lifted: false,
		},
		feedback: 'pasted — drag or arrows to place, Enter to drop',
	};
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
// Eyedropper & ink nudge (spec #387) — sampling and stepping the active ink
// ---------------------------------------------------------------------------

// The rail's ink order: the palette entries as listed, then transparent. Both
// the `c` quick-pick and the `;`/`'` nudge walk exactly this order, so they
// agree with the swatches the rail draws.
export function inkOrder(entries: readonly PaletteEntry[]): Ink[] {
	return [...entries.map((e) => colorInk(e.key)), TRANSPARENT_INK];
}

function sampleKey(state: SpriteEditorState, key: string): SpriteEditorState {
	const resolved = key === SENTINEL ? state.doc.key : key;
	if (!validKey(resolved))
		return { ...state, feedback: 'nothing to sample here' };
	return {
		...state,
		ink: colorInk(resolved),
		feedback: `sampled '${resolved}'`,
	};
}

// Sample the colour KEY at the exact Pixel and make it the active ink (spec
// #387: the eyedropper picks the palette key, never the RGBA, so a sampled ink
// stays semantically linked to the palette). A lit Pixel yields its foreground
// key; an unlit Pixel of an opaque cell yields the background key filling the
// complement; a transparent Pixel yields the transparent ink. A SENTINEL key
// resolves to the frame's default (as the renderer does). This is the shared
// primitive behind the one-shot `i` key and the momentary alt-click.
export function eyedropAt(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	if (px < 0 || py < 0)
		return { ...state, feedback: 'nothing to sample past the canvas edge' };
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	// A stamped (non-quadrant) cell: sample the glyph's colour key.
	if (cell.mask === undefined) return sampleKey(state, cell.fg);
	const lit = (cell.mask & (1 << bit)) !== 0;
	if (lit) return sampleKey(state, cell.fg);
	// Unlit: an opaque cell shows its background colour here; otherwise the Pixel
	// is a transparent hole and transparent is itself a first-class ink.
	if (cell.bg !== '' && cell.bg !== SENTINEL) return sampleKey(state, cell.bg);
	return { ...state, ink: TRANSPARENT_INK, feedback: 'sampled transparent' };
}

// Step the active ink to the adjacent rail swatch (spec #387: `;` back, `'`
// forward). Wraps at both ends so a nudge never dead-ends. `entries` comes from
// paletteEntries() so the nudge walks exactly the rail's swatches.
export function nudgeInk(
	state: SpriteEditorState,
	entries: readonly PaletteEntry[],
	dir: 1 | -1,
): SpriteEditorState {
	const inks = inkOrder(entries);
	if (inks.length === 0) return state;
	const cur = inks.findIndex((i) => inkEquals(i, state.ink));
	const from = cur < 0 ? 0 : cur;
	const next = inks[(from + dir + inks.length) % inks.length];
	return { ...state, ink: next, feedback: '' };
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
