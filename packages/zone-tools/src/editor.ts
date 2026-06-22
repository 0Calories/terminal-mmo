// The Zone editor's pure navigation + canvas core (ADR 0010, issue #94). The
// author moves a single crosshair cursor over a free-roaming, auto-growing canvas
// — painting into virgin space extends the inferred dimensions, deleting the far
// edge shrinks them back on save. This module owns the geometry (extent, grow,
// trim), the edit-scroll viewport (scrolloff), and the status line; the opentui
// shell at the bottom draws the rulers/crosshair/palette and is eyeball-only per
// the PRD. All geometry sits on top of the lossless `EditorDoc` (doc.ts).

import {
	BOX,
	buildSceneStyle,
	type Catalogs,
	type Diagnostic,
	findOrphanGlyphs,
	NPC_BOX,
	PORTAL_BOX,
	parseZone,
	renderZoneScene,
	validateZone,
	ZONE_MAX,
} from '@mmo/shared';
// Type-only import is erased at compile time, so it never loads opentui's
// runtime — the pure helpers above stay testable without a terminal.
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import { cellAt, type EditorDoc, parseDoc, serializeDoc } from './doc';
import { loadCatalogs, loadZone, writeZone } from './io';
import { buildPalette, erase, type Placeable, place } from './placeable';
import { type Cam, sceneOf } from './preview';

// --- Pure geometry (unit-tested; the opentui shell below is manual per PRD) ----

/** The inferred Zone dimensions from the document's content — width is the
 *  longest row, height is the row count. Matches how `parseZone` infers extents,
 *  so the editor's canvas size is exactly what will ship. */
export function editorExtent(doc: EditorDoc): { w: number; h: number } {
	return {
		w: doc.rows.reduce((m, r) => Math.max(m, r.length), 0),
		h: doc.rows.length,
	};
}

/**
 * Return a doc whose grid is large enough to include `(x, y)`, appending empty
 * rows below the content as needed (column width is padded by `setCell`/`place`
 * at paint time). A coordinate that is negative or beyond `ZONE_MAX` is a no-op,
 * so the canvas can never grow past the engine's hard cap.
 */
export function growToInclude(doc: EditorDoc, x: number, y: number): EditorDoc {
	if (x < 0 || y < 0 || x >= ZONE_MAX.w || y >= ZONE_MAX.h) return doc;
	if (y < doc.rows.length) return doc;
	const rows = doc.rows.slice();
	while (rows.length <= y) rows.push('');
	return { header: doc.header, rows };
}

/**
 * Trim the canvas back to its true content: drop trailing empty cells (`.`/space)
 * from each row, then drop trailing empty rows. These cells are redundant —
 * `parseZone` treats any cell past a row's end as empty — so trimming is lossless
 * yet shrinks the inferred extent (the "delete the far edge → smaller on save"
 * half of #94). The header is untouched. Run on serialize, not on every edit.
 */
export function trimDoc(doc: EditorDoc): EditorDoc {
	const rows = doc.rows.map((r) => r.replace(/[.\s]+$/, ''));
	while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
	return { header: doc.header, rows };
}

/**
 * Clamp a cursor coordinate to the roam region: the content extent plus `margin`
 * cells of virgin space (so the author can move into empty canvas to paint there),
 * floored at the origin and capped one cell inside `ZONE_MAX`.
 */
export function clampRoam(
	doc: EditorDoc,
	x: number,
	y: number,
	margin: number,
): { x: number; y: number } {
	const ext = editorExtent(doc);
	return {
		x: Math.max(0, Math.min(x, ext.w + margin, ZONE_MAX.w - 1)),
		y: Math.max(0, Math.min(y, ext.h + margin, ZONE_MAX.h - 1)),
	};
}

/**
 * Edit-scroll one axis: keep `cursor` within `scrolloff` cells of either margin of
 * a `viewLen`-wide window currently at `cam`. The window holds still while the
 * cursor roams the comfortable middle band and only scrolls when the cursor nears
 * an edge (vim's `scrolloff`). Never scrolls before the origin; unlike the preview
 * camera it does NOT clamp to the content's far edge, so the cursor can roam into
 * virgin canvas to paint there.
 */
export function scrollAxis(
	cam: number,
	cursor: number,
	viewLen: number,
	scrolloff: number,
): number {
	// A band wider than the window collapses to "keep the cursor on screen".
	const off = Math.min(scrolloff, Math.floor((viewLen - 1) / 2));
	const lo = cam + off;
	const hi = cam + viewLen - 1 - off;
	let next = cam;
	if (cursor < lo) next = cursor - off;
	else if (cursor > hi) next = cursor - viewLen + 1 + off;
	return Math.max(0, next);
}

/** Apply the scrolloff edit-scroll to both axes, returning the new camera. */
export function scrollViewport(
	cam: Cam,
	cursor: { x: number; y: number },
	viewW: number,
	viewH: number,
	scrolloff: number,
): Cam {
	return {
		x: scrollAxis(cam.x, cursor.x, viewW, scrolloff),
		y: scrollAxis(cam.y, cursor.y, viewH, scrolloff),
	};
}

/**
 * Which way the cursor lies relative to the viewport, as a unit step per axis:
 * `-1`/`+1` when it is off the near/far edge, `0` when on screen. After a
 * middle-mouse free pan the cursor can leave the viewport; the shell draws an edge
 * arrow in this direction (and any cursor move re-reveals it via `scrollViewport`).
 */
export function cursorEdge(
	cursor: { x: number; y: number },
	cam: Cam,
	viewW: number,
	viewH: number,
): { dx: number; dy: number } {
	const axis = (c: number, camMin: number, len: number) =>
		c < camMin ? -1 : c >= camMin + len ? 1 : 0;
	return {
		dx: axis(cursor.x, cam.x, viewW),
		dy: axis(cursor.y, cam.y, viewH),
	};
}

/**
 * The live health of the document, exactly as `zone check` would report it:
 * serialize → `parseZone` (a failure is one parse-error finding) → `validateZone`
 * plus the raw-text `findOrphanGlyphs` pass. Going through the same code path as
 * the CLI means the editor's health badge can never drift from CI.
 */
export function docDiagnostics(
	doc: EditorDoc,
	catalogs: Catalogs,
): Diagnostic[] {
	const text = serializeDoc(doc);
	let zone: ReturnType<typeof parseZone>;
	try {
		zone = parseZone(text, catalogs);
	} catch (e) {
		return [
			{
				severity: 'error',
				zoneId: typeof doc.header.id === 'string' ? doc.header.id : '?',
				message: `parse failed: ${(e as Error).message}`,
			},
		];
	}
	return [...validateZone(zone, catalogs), ...findOrphanGlyphs(text)];
}

/** The inputs the status line summarizes. `tool`/`placeable` are the active
 *  modal Tool (#95) and Placeable selections. */
export interface StatusLineModel {
	tool: string;
	placeable: string;
	cursor: { x: number; y: number };
	dirty: boolean;
	diags: Diagnostic[];
}

/**
 * The one-line editor status bar: active Tool · active Placeable · `(x,y)` cursor
 * · a `*` when there are unsaved edits · a health badge (`✓` when clean, else
 * `✗N` with the first error message) · the save/quit hints. Pure, like
 * `playStatusLine`; the shell paints the returned string.
 */
export function editorStatusLine(m: StatusLineModel): string {
	const errors = m.diags.filter((d) => d.severity === 'error');
	const health =
		errors.length === 0 ? '✓' : `✗${errors.length}: ${errors[0].message}`;
	const dirty = m.dirty ? ' *' : '';
	return `${m.tool} · ${m.placeable} · (${m.cursor.x},${m.cursor.y})${dirty}  ${health}  · ^s save · q quit`;
}

// --- Modal tools (#95): geometry, eyedropper, and select/clipboard ops --------

/** A modal editing tool. `drag` tools work over an anchor→cursor gesture
 *  (Rectangle/Line/Select drag A→B); the others act on the single cursor cell.
 *  `key` is the tool's mnemonic; it never collides with a movement key. */
export interface ToolDef {
	id: 'brush' | 'eraser' | 'eyedropper' | 'rectangle' | 'line' | 'select';
	label: string;
	key: string;
	drag: boolean;
}

export type ToolId = ToolDef['id'];

/** The six modal tools, in palette order. Flood-fill is deferred (#95 scope). */
export const TOOLS: readonly ToolDef[] = [
	{ id: 'brush', label: 'Brush', key: 'b', drag: false },
	{ id: 'eraser', label: 'Eraser', key: 'e', drag: false },
	{ id: 'eyedropper', label: 'Eyedropper', key: 'i', drag: false },
	{ id: 'rectangle', label: 'Rectangle', key: 'r', drag: true },
	{ id: 'line', label: 'Line', key: 'g', drag: true },
	{ id: 'select', label: 'Select', key: 'v', drag: true },
];

/**
 * Resolve a key to a tool: its mnemonic letter, or its 1-based digit. Line and
 * Select get digit-only access because their natural letters (`l`/`s`) are taken
 * by movement — but every tool stays reachable with no mouse (SSH/tmux parity).
 */
export function toolByKey(key: string): ToolDef | undefined {
	const byLetter = TOOLS.find((t) => t.key === key);
	if (byLetter) return byLetter;
	const n = Number.parseInt(key, 10);
	return String(n) === key && n >= 1 && n <= TOOLS.length
		? TOOLS[n - 1]
		: undefined;
}

/** A grid coordinate. */
export interface Point {
	x: number;
	y: number;
}

/** Every cell of the filled axis-aligned rectangle spanning corners `a`..`b`
 *  (inclusive, order-independent) — a wall/room is one Rectangle drag. */
export function rectCells(a: Point, b: Point): Point[] {
	const x0 = Math.min(a.x, b.x);
	const x1 = Math.max(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	const y1 = Math.max(a.y, b.y);
	const cells: Point[] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) cells.push({ x, y });
	return cells;
}

/** Every cell on the straight line from `a` to `b` via Bresenham (inclusive
 *  endpoints) — a floor is one Line drag; horizontal/vertical are special cases. */
export function lineCells(a: Point, b: Point): Point[] {
	const dx = Math.abs(b.x - a.x);
	const dy = Math.abs(b.y - a.y);
	const sx = a.x < b.x ? 1 : -1;
	const sy = a.y < b.y ? 1 : -1;
	let x = a.x;
	let y = a.y;
	let err = dx - dy;
	const cells: Point[] = [];
	// dx/dy is the longest axis span, so dx/dy+1 = the cell count (endpoints incl).
	for (let i = 0, steps = Math.max(dx, dy); i <= steps; i++) {
		cells.push({ x, y });
		const e2 = 2 * err;
		if (e2 > -dy) {
			err -= dy;
			x += sx;
		}
		if (e2 < dx) {
			err += dx;
			y += sy;
		}
	}
	return cells;
}

/** Stamp a Placeable across many cells, growing the canvas to include each (a
 *  Brush stroke, or a Rectangle/Line commit). */
export function paintCells(
	doc: EditorDoc,
	cells: Point[],
	p: Placeable,
): EditorDoc {
	return cells.reduce(
		(d, c) => place(growToInclude(d, c.x, c.y), c.x, c.y, p),
		doc,
	);
}

/** Erase many cells, garbage-collecting any glyph whose last instance is removed. */
export function eraseCells(doc: EditorDoc, cells: Point[]): EditorDoc {
	return cells.reduce((d, c) => erase(d, c.x, c.y), doc);
}

/** Read a header map as a plain object (absent / non-object → empty). */
function readHeaderMap(doc: EditorDoc, name: string): Record<string, unknown> {
	const m = doc.header[name];
	return m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
}

/**
 * The Placeable currently under `(x, y)`, resolved from the grid glyph plus the
 * header maps — what the Eyedropper adopts. Terrain `#` → terrain; a declared
 * spawn/npc/portal glyph → that Placeable; an empty or undeclared cell → undefined.
 */
export function placeableAt(
	doc: EditorDoc,
	x: number,
	y: number,
): Placeable | undefined {
	const ch = cellAt(doc, x, y);
	if (ch === '.' || ch === ' ') return undefined;
	if (ch === '#') return { kind: 'terrain' };
	const spawn = readHeaderMap(doc, 'spawns')[ch];
	if (spawn !== undefined) return { kind: 'monster', id: String(spawn) };
	const npc = readHeaderMap(doc, 'npcs')[ch];
	if (npc !== undefined) return { kind: 'npc', id: String(npc) };
	const portal = readHeaderMap(doc, 'portals')[ch];
	if (portal !== undefined) {
		const o = portal as { target?: unknown; arrival?: unknown };
		const arr = (o.arrival as [number, number] | undefined) ?? [0, 0];
		return {
			kind: 'portal',
			target: String(o.target ?? ''),
			arrival: [arr[0], arr[1]],
		};
	}
	return undefined;
}

/** A captured rectangle of Placeables, ready to paste. Empty cells are not
 *  captured; offsets are relative to the region's top-left. */
export interface Clip {
	w: number;
	h: number;
	cells: { dx: number; dy: number; placeable: Placeable }[];
}

/** Capture the Placeables in the rectangle `a`..`b` into a clipboard (empty cells
 *  skipped). Stores Placeables, not raw glyphs, so a paste re-resolves the header. */
export function copyRegion(doc: EditorDoc, a: Point, b: Point): Clip {
	const x0 = Math.min(a.x, b.x);
	const x1 = Math.max(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	const y1 = Math.max(a.y, b.y);
	const cells: Clip['cells'] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const placeable = placeableAt(doc, x, y);
			if (placeable) cells.push({ dx: x - x0, dy: y - y0, placeable });
		}
	return { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
}

/** Stamp a clipboard with its top-left at `(x, y)`, growing as needed. Because it
 *  re-places Placeables, a pasted catalog entity reuses (or freshly declares) its
 *  glyph — never an orphan or a duplicate declaration. */
export function pasteClip(
	doc: EditorDoc,
	clip: Clip,
	x: number,
	y: number,
): EditorDoc {
	return clip.cells.reduce((d, c) => {
		const px = x + c.dx;
		const py = y + c.dy;
		return place(growToInclude(d, px, py), px, py, c.placeable);
	}, doc);
}

/** Erase every cell in the rectangle `a`..`b` (Select → delete). */
export function deleteRegion(doc: EditorDoc, a: Point, b: Point): EditorDoc {
	return eraseCells(doc, rectCells(a, b));
}

/**
 * Move the rectangle `a`..`b` by `(dx, dy)`: capture, clear the source, then paste
 * at the offset. Placeables (not raw glyphs) move, so the header stays consistent —
 * no orphan declaration is left behind and none is duplicated.
 */
export function moveRegion(
	doc: EditorDoc,
	a: Point,
	b: Point,
	dx: number,
	dy: number,
): EditorDoc {
	const clip = copyRegion(doc, a, b);
	const cleared = deleteRegion(doc, a, b);
	const x0 = Math.min(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	return pasteClip(cleared, clip, x0 + dx, y0 + dy);
}

// --- Placement feedback (#96): footprint, grounding state, ground-snap ---------

/** A rectangular footprint anchored at its top-left. */
export interface FootBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The engine-derived collision box an entity Placeable occupies when its anchor
 * glyph sits at `(x, y)` — the glyph is the box's TOP-LEFT corner (ADR 0008).
 * Dimensions come from the shared constants `parseZone` builds its boxes from, so
 * the editor's placement ghost can't drift from what `zone check` validates.
 * Terrain has no real footprint (it stamps one solid cell).
 */
export function footprintBox(p: Placeable, x: number, y: number): FootBox {
	switch (p.kind) {
		case 'monster':
			return { x, y, w: BOX.w, h: BOX.h };
		case 'npc':
			return { x, y, w: NPC_BOX.w, h: NPC_BOX.h };
		case 'portal':
			return { x, y, w: PORTAL_BOX.w, h: PORTAL_BOX.h };
		case 'terrain':
			return { x, y, w: 1, h: 1 };
	}
}

/**
 * Editor-grid solidity, matching the runtime's `isSolid` (shared/terrain): a `#`
 * cell is solid; horizontal out-of-bounds and below the canvas read as solid
 * wall/floor, above the canvas as open sky. Lets the placement checks see the same
 * world the validator/runtime does (incl. the implicit world floor).
 */
function gridSolid(
	doc: EditorDoc,
	ext: { w: number; h: number },
	x: number,
	y: number,
): boolean {
	if (x < 0 || x >= ext.w) return true;
	if (y < 0) return false;
	if (y >= ext.h) return true;
	return cellAt(doc, x, y) === '#';
}

/** Does the box fit entirely within the current canvas extent? */
function boxInBounds(b: FootBox, ext: { w: number; h: number }): boolean {
	return b.x >= 0 && b.y >= 0 && b.x + b.w <= ext.w && b.y + b.h <= ext.h;
}

/** Any in-grid cell under the footprint is solid terrain (`#`). Mirrors the
 *  validator's `clipsSolid` — out-of-bounds is `boxInBounds`'s concern, not this. */
function boxClips(doc: EditorDoc, b: FootBox): boolean {
	for (let y = b.y; y < b.y + b.h; y++)
		for (let x = b.x; x < b.x + b.w; x++)
			if (cellAt(doc, x, y) === '#') return true;
	return false;
}

/** Some cell directly below the box bottom is solid (incl. the world floor). */
function boxRestsOnGround(
	doc: EditorDoc,
	ext: { w: number; h: number },
	b: FootBox,
): boolean {
	const below = b.y + b.h;
	for (let x = b.x; x < b.x + b.w; x++)
		if (gridSolid(doc, ext, x, below)) return true;
	return false;
}

/** The three placement states the ghost footprint is tinted by (#96). */
export type PlacementState = 'grounded' | 'airborne' | 'invalid';

/**
 * Classify where an entity Placeable would land if its anchor were `(x, y)`, using
 * the SAME footprint/clip/ground rules the validator applies — so the green/blue/red
 * ghost predicts exactly what `zone check` will say. `invalid` (red) = the footprint
 * clips solid terrain or extends off the canvas; `airborne` (blue) = it fits but has
 * no solid beneath its feet (informational — not an error for Monsters until #90);
 * `grounded` (green) = it rests on ground. Portals need no ground; terrain is always
 * placeable.
 */
export function placementState(
	doc: EditorDoc,
	p: Placeable,
	x: number,
	y: number,
): PlacementState {
	if (p.kind === 'terrain') return 'grounded';
	const ext = editorExtent(doc);
	const box = footprintBox(p, x, y);
	if (!boxInBounds(box, ext) || boxClips(doc, box)) return 'invalid';
	const needsGround = p.kind === 'monster' || p.kind === 'npc';
	if (needsGround && !boxRestsOnGround(doc, ext, box)) return 'airborne';
	return 'grounded';
}

/**
 * Auto-ground-snap (#96): drop an entity's anchor so its feet rest on the nearest
 * solid surface at or below the cursor. Scans the footprint columns downward for the
 * first solid row — a `#` cell or the implicit canvas floor — and seats the box just
 * above it. An already-grounded anchor (or a Placeable with no surface below, or
 * terrain) is returned unchanged. The shell offers a free-place modifier that
 * bypasses this to drop exactly at the cursor (incl. mid-air).
 */
export function groundSnap(
	doc: EditorDoc,
	p: Placeable,
	x: number,
	y: number,
): { x: number; y: number } {
	if (p.kind === 'terrain') return { x, y };
	const ext = editorExtent(doc);
	const box = footprintBox(p, x, y);
	// The first solid row at or below the box's current bottom edge.
	for (let r = y + box.h; r <= ext.h; r++) {
		let solid = false;
		for (let cx = x; cx < x + box.w; cx++)
			if (gridSolid(doc, ext, cx, r)) {
				solid = true;
				break;
			}
		if (solid) return { x, y: Math.max(0, r - box.h) };
	}
	return { x, y };
}

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

// Editor frame geometry. The scene fills the buffer; the rulers + footer overpaint
// its edges, so the visible canvas is the inset region.
const RULER_H = 1; // top column ruler
const GUTTER_W = 4; // left row ruler (up to 3 digits + tick)
const FOOTER_H = 3; // tool bar + status line + palette bar
const SCROLLOFF = 4; // edit-scroll margin before the viewport follows
const ROAM_MARGIN = 16; // virgin space the cursor may roam past the content

/** One Placeable the editor can stamp, with its display label (flattened from the
 *  Palette groups; stub slots without a Placeable are skipped). */
interface PaletteEntry {
	label: string;
	placeable: Placeable;
}

function flattenPalette(catalogs: Catalogs): PaletteEntry[] {
	return buildPalette(catalogs).flatMap((g) =>
		g.items.flatMap((i) =>
			i.placeable ? [{ label: i.label, placeable: i.placeable }] : [],
		),
	);
}

/**
 * `zone edit <id>`: mount the entity-centric editor over an authored Zone. A
 * single crosshair cursor roams a free-growing canvas with wasd / vim (hjkl) /
 * arrow keys. Six modal Tools (#95) drive the canvas: Brush stamps the active
 * Placeable, Eraser clears, Eyedropper adopts the Placeable under the cursor,
 * Rectangle/Line drag a region A→B (anchor on `space`, commit on `space`), and
 * Select captures a region for copy (`c`) / cut (`x`) / paste (`p`) / delete.
 * Tools switch by mnemonic key, `1`-`6`, or a click on the tool bar; with a
 * mouse, click/drag drives the cursor and middle-mouse free-pans the camera —
 * but every Tool is fully reachable with no mouse (SSH/tmux parity). `tab` cycles
 * the Placeable, `^s` saves (trimming the trailing empties), `q` quits. The
 * rulers, crosshair, status/tool/palette bars are drawn here and validated by eye
 * (PRD); all geometry comes from the pure helpers above. Reuses the shared
 * renderer (#56) and the lossless `EditorDoc`, so nothing is lost on a round-trip.
 * Long-lived: opentui owns the process lifecycle (ctrl-c / q exit).
 */
export async function runEdit(args: string[], deps: CliDeps): Promise<void> {
	const id = args[0];
	if (!id) {
		deps.log('edit: missing <id>');
		process.exitCode = 1;
		return;
	}

	// The editor only opens a parseable file (it edits the raw doc, but needs the
	// initial parse to render and to report a clear error otherwise).
	const catalogs = loadCatalogs(deps.root);
	const loaded = loadZone(deps.root, id, catalogs);
	if (!loaded.zone || loaded.text === undefined) {
		deps.log(`edit: cannot open '${id}': ${loaded.parseError}`);
		process.exitCode = 1;
		return;
	}

	let doc = parseDoc(loaded.text);
	const cursor = { x: 0, y: 0 };
	const cam: Cam = { x: 0, y: 0 };
	const palette = flattenPalette(catalogs);
	let selIdx = 0; // active Placeable (defaults to Terrain Solid)
	let toolIdx = 0; // active Tool (defaults to Brush)
	let anchor: Point | null = null; // in-progress drag gesture start (rect/line/select)
	let selection: { a: Point; b: Point } | null = null; // captured Select region
	let clip: Clip | null = null; // copy/cut buffer
	let panned = false; // middle-mouse free pan detached the camera from the cursor
	let freePlace = false; // `f` drops entities at the cursor instead of ground-snapping
	let savedText = serializeDoc(trimDoc(doc));
	let dirty = false;
	let diags = docDiagnostics(doc, catalogs);
	let scene = sceneOf(loaded.zone); // last-good scene; kept on a parse failure
	let pendingQuit = false;

	// Footer hit-test spans, recomputed each frame so mouse clicks select the Tool
	// / Placeable under the pointer (keyboard parity is the canonical path).
	let frameW = 0;
	let frameH = 0;
	let toolHits: { x0: number; x1: number; idx: number }[] = [];
	let paletteHits: { x0: number; x1: number; idx: number }[] = [];

	const recompute = () => {
		dirty = serializeDoc(trimDoc(doc)) !== savedText;
		diags = docDiagnostics(doc, catalogs);
		try {
			scene = sceneOf(parseZone(serializeDoc(doc), catalogs));
		} catch {
			// Keep the last good scene so a transient empty/invalid grid doesn't blank
			// the canvas mid-edit.
		}
	};

	const { createCliRenderer, Renderable, RGBA } = await import('@opentui/core');
	const style = buildSceneStyle((r, g, b, a) => RGBA.fromInts(r, g, b, a));
	// Editor chrome colours (distinct from scene colours so the frame reads as UI).
	const C = {
		chromeBg: RGBA.fromInts(22, 25, 34, 255),
		rulerFg: RGBA.fromInts(110, 120, 140, 255),
		tickFg: RGBA.fromInts(170, 182, 205, 255),
		crossBg: RGBA.fromInts(40, 46, 64, 255),
		crossFg: RGBA.fromInts(96, 108, 134, 255),
		cursorBg: RGBA.fromInts(245, 215, 95, 255),
		cursorFg: RGBA.fromInts(20, 22, 30, 255),
		floorFg: RGBA.fromInts(60, 70, 92, 255),
		textFg: RGBA.fromInts(232, 232, 238, 255),
		dimFg: RGBA.fromInts(140, 148, 164, 255),
		hot: RGBA.fromInts(245, 215, 95, 255),
		gestureBg: RGBA.fromInts(70, 96, 70, 255), // in-progress rect/line drag
		selBg: RGBA.fromInts(58, 72, 104, 255), // captured Select region
		ghostOk: RGBA.fromInts(40, 110, 60, 255), // grounded footprint — green
		ghostAir: RGBA.fromInts(48, 80, 134, 255), // airborne footprint — blue
		ghostBad: RGBA.fromInts(130, 48, 48, 255), // invalid footprint — red
	};

	class EditRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const W = buf.width;
			const H = buf.height;
			frameW = W;
			frameH = H;
			const viewW = Math.max(1, W - GUTTER_W);
			const viewH = Math.max(1, H - RULER_H - FOOTER_H);
			// Keep the cursor inside the scrolloff band (edit-scroll viewport). While
			// the camera is free-panned (middle-mouse) it stays put; any cursor move
			// clears `panned` so the viewport re-follows and re-reveals the cursor.
			if (!panned) {
				const next = scrollViewport(cam, cursor, viewW, viewH, SCROLLOFF);
				cam.x = next.x;
				cam.y = next.y;
			}

			// World→screen: the canvas origin (GUTTER_W, RULER_H) shows world `cam`.
			// renderZoneScene maps screen→world via its own camera, so shift it left/up
			// by the chrome inset; the rulers/footer overpaint the bleed.
			renderZoneScene(
				buf,
				scene,
				{ x: cam.x - GUTTER_W, y: cam.y - RULER_H },
				style,
			);

			const ext = editorExtent(doc);
			const sx = (wx: number) => GUTTER_W + (wx - cam.x);
			const sy = (wy: number) => RULER_H + (wy - cam.y);
			const inCanvasX = (x: number) => x >= GUTTER_W && x < W;
			const inCanvasY = (y: number) => y >= RULER_H && y < RULER_H + viewH;

			// Floor guide: a faint line just below the content's bottom row, so the
			// author sees where the canvas currently ends (only over empty cells).
			const floorY = sy(ext.h);
			if (inCanvasY(floorY))
				for (let x = GUTTER_W; x < W; x++)
					buf.setCell(x, floorY, '─', C.floorFg, style.terrainBg);

			// Crosshair: tint the cursor's row + column, but only over empty doc cells
			// so authored content stays readable. The bright intersection is the cursor.
			const cx = sx(cursor.x);
			const cy = sy(cursor.y);
			for (let y = RULER_H; y < RULER_H + viewH; y++) {
				const wy = cam.y + (y - RULER_H);
				if (inCanvasX(cx) && cellAt(doc, cursor.x, wy) === '.')
					buf.setCell(cx, y, '·', C.crossFg, C.crossBg);
			}
			for (let x = GUTTER_W; x < W; x++) {
				const wx = cam.x + (x - GUTTER_W);
				if (inCanvasY(cy) && cellAt(doc, wx, cursor.y) === '.')
					buf.setCell(x, cy, '·', C.crossFg, C.crossBg);
			}
			if (inCanvasX(cx) && inCanvasY(cy)) {
				const here = cellAt(doc, cursor.x, cursor.y);
				buf.setCell(cx, cy, here === '.' ? '+' : here, C.cursorFg, C.cursorBg);
			}

			// Region highlight: the in-progress drag (anchor→cursor, shaped by the
			// active Tool) and any captured Select region, so A→B reads before commit.
			const tint = (cells: Point[], bg: typeof C.selBg) => {
				for (const p of cells) {
					const px = sx(p.x);
					const py = sy(p.y);
					if (!inCanvasX(px) || !inCanvasY(py)) continue;
					const here = cellAt(doc, p.x, p.y);
					buf.setCell(px, py, here === '.' ? '·' : here, C.cursorFg, bg);
				}
			};
			if (selection) tint(rectCells(selection.a, selection.b), C.selBg);
			if (anchor) {
				const cells =
					TOOLS[toolIdx].id === 'line'
						? lineCells(anchor, cursor)
						: rectCells(anchor, cursor);
				tint(cells, C.gestureBg);
			}

			// Ghost footprint (#96): while a Brush holds an entity Placeable, preview the
			// 5×5 / 4×5 / 4×7 collision box at the spot it will actually land (ground-
			// snapped unless free-place), tinted by its placement state — green grounded,
			// blue airborne, red clipping/off-canvas — so floating/clipping entities are
			// visible before they're stamped. Drawn under the cursor marker, which is
			// re-stamped on top so it stays crisp.
			const ghostP = palette[selIdx]?.placeable;
			if (
				ghostP &&
				ghostP.kind !== 'terrain' &&
				TOOLS[toolIdx].id === 'brush' &&
				!anchor
			) {
				const a = freePlace
					? cursor
					: groundSnap(doc, ghostP, cursor.x, cursor.y);
				const box = footprintBox(ghostP, a.x, a.y);
				const st = placementState(doc, ghostP, a.x, a.y);
				const bg =
					st === 'grounded'
						? C.ghostOk
						: st === 'airborne'
							? C.ghostAir
							: C.ghostBad;
				tint(
					rectCells(
						{ x: box.x, y: box.y },
						{ x: box.x + box.w - 1, y: box.y + box.h - 1 },
					),
					bg,
				);
				if (inCanvasX(cx) && inCanvasY(cy)) {
					const here = cellAt(doc, cursor.x, cursor.y);
					buf.setCell(
						cx,
						cy,
						here === '.' ? '+' : here,
						C.cursorFg,
						C.cursorBg,
					);
				}
			}

			// Off-screen indicator: live once a middle-mouse free pan detaches the cam.
			const edge = cursorEdge(cursor, cam, viewW, viewH);
			if (edge.dx || edge.dy) {
				const ax = edge.dx < 0 ? GUTTER_W : edge.dx > 0 ? W - 1 : cx;
				const ay =
					edge.dy < 0 ? RULER_H : edge.dy > 0 ? RULER_H + viewH - 1 : cy;
				const glyph =
					edge.dx < 0 ? '◀' : edge.dx > 0 ? '▶' : edge.dy < 0 ? '▲' : '▼';
				if (inCanvasX(ax) && inCanvasY(ay))
					buf.setCell(ax, ay, glyph, C.hot, C.chromeBg);
			}

			// Top column ruler: ticks every 5, the tens label, cursor column hot.
			buf.fillRect(0, 0, W, RULER_H, C.chromeBg);
			for (let x = GUTTER_W; x < W; x++) {
				const wx = cam.x + (x - GUTTER_W);
				const hot = wx === cursor.x;
				if (wx % 10 === 0) {
					const lbl = String(wx);
					buf.drawText(lbl, x, 0, hot ? C.hot : C.tickFg, C.chromeBg);
				} else if (wx % 5 === 0) {
					buf.setCell(x, 0, '·', hot ? C.hot : C.rulerFg, C.chromeBg);
				} else if (hot) {
					buf.setCell(x, 0, '▾', C.hot, C.chromeBg);
				}
			}

			// Left row ruler: right-aligned row number per canvas row, cursor row hot.
			buf.fillRect(0, RULER_H, GUTTER_W, viewH, C.chromeBg);
			for (let y = RULER_H; y < RULER_H + viewH; y++) {
				const wy = cam.y + (y - RULER_H);
				const hot = wy === cursor.y;
				const lbl = String(wy).padStart(GUTTER_W - 1, ' ');
				buf.drawText(lbl, 0, y, hot ? C.hot : C.rulerFg, C.chromeBg);
			}
			buf.fillRect(0, 0, GUTTER_W, RULER_H, C.chromeBg); // corner

			// Tool bar: the six modal Tools, the active one bracketed + highlighted.
			// Each label's span is recorded so a mouse click selects that Tool.
			const toolbarRow = H - FOOTER_H;
			buf.fillRect(0, toolbarRow, W, 1, C.chromeBg);
			toolHits = [];
			let tx = 0;
			for (let i = 0; i < TOOLS.length && tx < W; i++) {
				const active = i === toolIdx;
				const label = `${TOOLS[i].label}(${TOOLS[i].key})`;
				const seg = active ? `[${label}]` : ` ${label} `;
				buf.drawText(
					seg.slice(0, W - tx),
					tx,
					toolbarRow,
					active ? C.hot : C.dimFg,
					C.chromeBg,
				);
				toolHits.push({ x0: tx, x1: tx + seg.length, idx: i });
				tx += seg.length;
			}
			// Placement-mode badge (#96): which way the active entity Brush will drop.
			const ghostMode = palette[selIdx]?.placeable;
			if (ghostMode && ghostMode.kind !== 'terrain') {
				const badge = freePlace ? 'free-place (f)' : 'ground-snap (f)';
				const bx = Math.max(tx + 1, W - badge.length);
				if (bx < W) buf.drawText(badge, bx, toolbarRow, C.dimFg, C.chromeBg);
			}

			// Status bar (now reflects the active Tool).
			const statusRow = H - 2;
			buf.fillRect(0, statusRow, W, 1, C.chromeBg);
			const status = editorStatusLine({
				tool: TOOLS[toolIdx].label,
				placeable: palette[selIdx]?.label ?? '—',
				cursor,
				dirty,
				diags,
			});
			buf.drawText(status.slice(0, W), 0, statusRow, C.textFg, C.chromeBg);

			// Palette bar: groups with the active Placeable bracketed + highlighted.
			const paletteRow = H - 1;
			buf.fillRect(0, paletteRow, W, 1, C.chromeBg);
			paletteHits = [];
			let px = 0;
			for (let i = 0; i < palette.length && px < W; i++) {
				const active = i === selIdx;
				const seg = active ? `[${palette[i].label}]` : ` ${palette[i].label} `;
				buf.drawText(
					seg.slice(0, W - px),
					px,
					paletteRow,
					active ? C.hot : C.dimFg,
					C.chromeBg,
				);
				paletteHits.push({ x0: px, x1: px + seg.length, idx: i });
				px += seg.length;
			}
			if (pendingQuit && px < W)
				buf.drawText(
					'  unsaved — q again to discard, ^s to save',
					Math.min(px, W - 1),
					paletteRow,
					C.hot,
					C.chromeBg,
				);
		}
	}

	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
		useMouse: true,
	});
	const view = new EditRenderable(renderer);
	renderer.root.add(view);

	// Moving the cursor re-attaches the viewport (undoes a middle-mouse free pan).
	const move = (dx: number, dy: number) => {
		const c = clampRoam(doc, cursor.x + dx, cursor.y + dy, ROAM_MARGIN);
		cursor.x = c.x;
		cursor.y = c.y;
		panned = false;
	};

	const save = () => {
		savedText = serializeDoc(trimDoc(doc));
		writeZone(deps.root, id, savedText);
		dirty = false;
	};

	const activeTool = () => TOOLS[toolIdx];
	const activeP = () => palette[selIdx]?.placeable;

	/** The palette index whose Placeable matches `p` (Eyedropper → reselect). */
	const paletteIndexOf = (p: Placeable): number =>
		palette.findIndex((e) => {
			const q = e.placeable;
			if (q.kind !== p.kind) return false;
			if (q.kind === 'monster' && p.kind === 'monster') return q.id === p.id;
			if (q.kind === 'npc' && p.kind === 'npc') return q.id === p.id;
			if (q.kind === 'portal' && p.kind === 'portal')
				return q.target === p.target;
			return q.kind === 'terrain';
		});

	// Where an entity actually lands: ground-snapped by default (#96), or exactly at
	// the cursor when free-place is on. Terrain never snaps.
	const placeAnchor = (x: number, y: number): Point => {
		const p = activeP();
		if (!p || freePlace) return { x, y };
		return groundSnap(doc, p, x, y);
	};

	const stampAt = (x: number, y: number) => {
		const p = activeP();
		if (!p) return;
		const a = placeAnchor(x, y);
		doc = place(growToInclude(doc, a.x, a.y), a.x, a.y, p);
		recompute();
	};
	const eraseAt = (x: number, y: number) => {
		doc = erase(doc, x, y);
		recompute();
	};

	// The Tool's primary action at the cursor (`space`/click). Drag tools toggle
	// the anchor (press A, then press B to commit); the rest act immediately.
	const toolPrimary = () => {
		const t = activeTool();
		if (t.id === 'brush') return stampAt(cursor.x, cursor.y);
		if (t.id === 'eraser') return eraseAt(cursor.x, cursor.y);
		if (t.id === 'eyedropper') {
			const picked = placeableAt(doc, cursor.x, cursor.y);
			if (picked) {
				const idx = paletteIndexOf(picked);
				if (idx >= 0) {
					selIdx = idx;
					toolIdx = 0; // hop back to Brush, ready to paint what was adopted
				}
			}
			return;
		}
		// Rectangle / Line / Select: first press anchors, second commits.
		if (!anchor) {
			anchor = { x: cursor.x, y: cursor.y };
			return;
		}
		commitGesture();
	};

	const commitGesture = () => {
		if (!anchor) return;
		const a = anchor;
		const b = { x: cursor.x, y: cursor.y };
		const t = activeTool();
		const p = activeP();
		if (t.id === 'rectangle' && p) {
			doc = paintCells(doc, rectCells(a, b), p);
			recompute();
		} else if (t.id === 'line' && p) {
			doc = paintCells(doc, lineCells(a, b), p);
			recompute();
		} else if (t.id === 'select') {
			selection = { a, b };
		}
		anchor = null;
	};

	// --- Mouse (eyeball-only): click/drag drives the one cursor; middle pans -----
	const inCanvasRegion = (sx: number, sy: number) =>
		sx >= GUTTER_W && sx < frameW && sy >= RULER_H && sy < frameH - FOOTER_H;
	const toWorld = (sx: number, sy: number) => ({
		x: cam.x + (sx - GUTTER_W),
		y: cam.y + (sy - RULER_H),
	});
	const moveCursorTo = (wx: number, wy: number) => {
		const c = clampRoam(doc, wx, wy, ROAM_MARGIN);
		cursor.x = c.x;
		cursor.y = c.y;
		panned = false;
	};
	let panLast: Point | null = null;

	view.onMouseDown = (e: { button: number; x: number; y: number }) => {
		pendingQuit = false;
		if (e.button === 1) {
			panLast = { x: e.x, y: e.y }; // middle-mouse: begin free pan
			return;
		}
		if (e.button !== 0) return;
		// Tool / palette bar clicks select without touching the canvas.
		if (e.y === frameH - FOOTER_H) {
			const hit = toolHits.find((h) => e.x >= h.x0 && e.x < h.x1);
			if (hit) {
				toolIdx = hit.idx;
				anchor = null;
			}
			return;
		}
		if (e.y === frameH - 1) {
			const hit = paletteHits.find((h) => e.x >= h.x0 && e.x < h.x1);
			if (hit) selIdx = hit.idx;
			return;
		}
		if (!inCanvasRegion(e.x, e.y)) return;
		const w = toWorld(e.x, e.y);
		moveCursorTo(w.x, w.y);
		if (activeTool().drag) anchor = { x: cursor.x, y: cursor.y };
		else toolPrimary();
	};

	view.onMouseDrag = (e: { button: number; x: number; y: number }) => {
		if (panLast) {
			cam.x = Math.max(0, cam.x - (e.x - panLast.x));
			cam.y = Math.max(0, cam.y - (e.y - panLast.y));
			panLast = { x: e.x, y: e.y };
			panned = true;
			return;
		}
		if (e.button !== 0 || !inCanvasRegion(e.x, e.y)) return;
		const w = toWorld(e.x, e.y);
		moveCursorTo(w.x, w.y);
		// Terrain/entity Brush drag-paints continuously; Eraser drag-erases. Drag
		// tools just trail the cursor — the region preview follows for free.
		if (activeTool().id === 'brush') stampAt(cursor.x, cursor.y);
		else if (activeTool().id === 'eraser') eraseAt(cursor.x, cursor.y);
	};

	const endDrag = (e: { button: number }) => {
		if (panLast && e.button === 1) {
			panLast = null;
			return;
		}
		if (anchor) commitGesture(); // safe: commitGesture clears the anchor
	};
	view.onMouseUp = endDrag;
	view.onMouseDragEnd = endDrag;
	// Wheel scrolls the canvas vertically (a quick way to roam tall Zones).
	view.onMouse = (e: { type: string; scroll?: { direction: string } }) => {
		if (e.type !== 'scroll' || !e.scroll) return;
		const dy =
			e.scroll.direction === 'up' ? -3 : e.scroll.direction === 'down' ? 3 : 0;
		if (dy) {
			cam.y = Math.max(0, cam.y + dy);
			panned = true;
		}
	};

	// True when the Select tool holds a captured region (gates copy/cut/delete).
	const hasSelection = () => activeTool().id === 'select' && selection !== null;

	renderer.keyInput.on('keypress', (k: { name: string; ctrl: boolean }) => {
		const wasPendingQuit = pendingQuit;
		pendingQuit = false;
		// Save is ^s so the bare `s` (and the rest of wasd) is free for movement.
		if (k.ctrl && k.name === 's') return save();

		// Tool selection (mnemonic letter or 1-6 digit). These never collide with a
		// movement key, so they're safe to intercept before the movement switch.
		const tool = toolByKey(k.name);
		if (tool) {
			toolIdx = TOOLS.indexOf(tool);
			anchor = null;
			return;
		}

		switch (k.name) {
			case 'left':
				return move(-1, 0);
			case 'right':
				return move(1, 0);
			case 'up':
				return move(0, -1);
			case 'down':
				return move(0, 1);
			case 'h':
				return move(-1, 0);
			case 'j':
				return move(0, 1);
			case 'k':
				return move(0, -1);
			case 'l':
				return move(1, 0);
			case 'w':
				return move(0, -1);
			case 'a':
				return move(-1, 0);
			case 'd':
				return move(1, 0);
			case 'space':
			case 'return':
			case 'enter':
				return toolPrimary();
			case 'escape':
				anchor = null;
				selection = null;
				return;
			case 'f': // toggle ground-snap vs. free-place for entity placement (#96)
				freePlace = !freePlace;
				return;
			case 'c': // Select → copy
				if (hasSelection() && selection)
					clip = copyRegion(doc, selection.a, selection.b);
				return;
			case 'p': // paste the clipboard at the cursor (any tool)
				if (clip) {
					doc = pasteClip(doc, clip, cursor.x, cursor.y);
					recompute();
				}
				return;
			case 'x':
				// In Select with a region: cut (copy + clear) so a paste moves it.
				if (hasSelection() && selection) {
					clip = copyRegion(doc, selection.a, selection.b);
					doc = deleteRegion(doc, selection.a, selection.b);
					selection = null;
					recompute();
				} else {
					eraseAt(cursor.x, cursor.y);
				}
				return;
			case 'backspace':
			case 'delete':
				// In Select with a region: delete it; otherwise erase the cursor cell.
				if (hasSelection() && selection) {
					doc = deleteRegion(doc, selection.a, selection.b);
					selection = null;
					recompute();
				} else {
					eraseAt(cursor.x, cursor.y);
				}
				return;
			case 'tab':
				if (palette.length > 0) selIdx = (selIdx + 1) % palette.length;
				return;
			case 'q':
				if (dirty && !wasPendingQuit) {
					pendingQuit = true;
					return;
				}
				(renderer as unknown as { destroy?: () => void }).destroy?.();
				process.exit(0);
		}
	});

	renderer.start();
}
