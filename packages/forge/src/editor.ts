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
	drawEntitySprite,
	drawNpcSprite,
	type Entity,
	findOrphanGlyphs,
	type GhostStyle,
	NPC_BOX,
	type Npc,
	PORTAL_BOX,
	parseZone,
	renderZoneScene,
	spawnMonster,
	validateZone,
	ZONE_MAX,
	type Zone,
} from '@mmo/shared';
// Type-only import is erased at compile time, so it never loads opentui's
// runtime — the pure helpers above stay testable without a terminal.
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import {
	cellAt,
	type EditorDoc,
	parseDoc,
	placedMonsterCount,
	serializeDoc,
	setZoneName,
	setZoneType,
	zoneName,
	zoneType,
} from './doc';
import { canRedo, canUndo, initHistory, record, redo, undo } from './history';
import { loadCatalogs, loadZone, loadZoneSet, writeZone } from './io';
import { buildPalette, erase, type Placeable, place } from './placeable';
import {
	type Arrival,
	defaultArrival,
	filterCandidates,
	formatArrival,
	type PortalCandidate,
	parseArrival,
	portalCandidates,
} from './portalForm';
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
	id: string,
): Diagnostic[] {
	const text = serializeDoc(doc);
	let zone: ReturnType<typeof parseZone>;
	try {
		zone = parseZone(text, catalogs, id);
	} catch (e) {
		return [
			{
				severity: 'error',
				zoneId: id,
				message: `parse failed: ${(e as Error).message}`,
			},
		];
	}
	return [...validateZone(zone, catalogs), ...findOrphanGlyphs(text, id)];
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

// --- Diagnostics panel (#100): pure drill-down helpers ------------------------

/**
 * The cell a diagnostic points at, or null when the finding isn't tied to one
 * (zone-type / orphan-glyph / catalog findings carry no `cell`). The diagnostics
 * panel uses this for jump-to-cell: a navigable row moves the cursor there.
 */
export function diagJumpTarget(d: Diagnostic): { x: number; y: number } | null {
	return d.cell ?? null;
}

/**
 * Keep a panel selection index inside `[0, count)` as the live diagnostics list
 * grows/shrinks under edits; 0 for an empty list.
 */
export function clampDiagIndex(idx: number, count: number): number {
	if (count <= 0) return 0;
	return Math.max(0, Math.min(idx, count - 1));
}

/**
 * One diagnostics-panel row: a severity marker (`✗` error / `▲` warning) plus the
 * finding's message. The message already embeds any coordinates, so the row stays
 * self-describing.
 */
export function formatDiagLine(d: Diagnostic): string {
	return `${d.severity === 'error' ? '✗' : '▲'} ${d.message}`;
}

/**
 * The panel header: counts by severity (pluralized), or an all-clear line. Mirrors
 * the at-a-glance status badge so the drill-down opens with the same verdict.
 */
export function diagPanelSummary(diags: Diagnostic[]): string {
	if (diags.length === 0) return 'No issues — zone is clean';
	const errors = diags.filter((d) => d.severity === 'error').length;
	const warnings = diags.length - errors;
	const parts: string[] = [];
	if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
	if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
	return parts.join(' · ');
}

// --- Modal tools (#95): geometry, eyedropper, and select/clipboard ops --------

/** A modal editing tool. `drag` tools work over an anchor→cursor gesture
 *  (Rectangle/Line/Select drag A→B); the others act on the single cursor cell.
 *  `key` is the tool's mnemonic; it never collides with a movement key. */
export interface ToolDef {
	id: 'brush' | 'eraser' | 'rectangle' | 'line' | 'select' | 'stamp';
	label: string;
	key: string;
	drag: boolean;
}

export type ToolId = ToolDef['id'];

/**
 * The six modal tools, in palette order (#114). Brush/Rectangle/Line paint terrain
 * only; Stamp places entities via its modal picker; Select is the region clipboard.
 * The Eyedropper was dropped with the bottom palette bar. Flood-fill is deferred.
 */
export const TOOLS: readonly ToolDef[] = [
	{ id: 'brush', label: 'Brush', key: 'b', drag: false },
	{ id: 'eraser', label: 'Eraser', key: 'e', drag: false },
	{ id: 'rectangle', label: 'Rectangle', key: 'r', drag: true },
	{ id: 'line', label: 'Line', key: 'g', drag: true },
	{ id: 'select', label: 'Select', key: 'v', drag: true },
	{ id: 'stamp', label: 'Stamp', key: 'p', drag: false },
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

/** The translucent glyph the placement ghost fills the footprint box with when a
 *  Placeable has no sprite preview yet (the portal fallback, #118). Sprite ghosts
 *  keep their real glyphs and fade the colours instead (see the `fade` in the Stamp
 *  preview). */
export const GHOST_GLYPH = '░';

/** How much of a sprite's own colour survives in its placement ghost; the rest is
 *  the placement-state tint it's composited onto. Low enough to read as translucent,
 *  high enough to keep the entity's hues recognisable (#118). */
const GHOST_OPACITY = 0.5;

/**
 * The scene object the placement ghost should draw to preview an entity Placeable
 * landing with its anchor glyph at `(x, y)` (#118). Rather than a coloured box, the
 * ghost is the entity's ACTUAL sprite — same art, same glyphs — blit with every
 * cell's colour faded onto the placement-state tint so it reads as a translucent
 * preview. Synthesising the very Entity/Npc that `parseZone` would spawn keeps
 * the preview from drifting from what ships (#56): a monster resolves to its
 * behaviour sprite, an NPC to its kind sprite. Returns `undefined` for kinds with
 * no sprite preview yet (portals — #97 — and terrain), so the caller can fall back.
 */
export function ghostEntity(
	catalogs: Catalogs,
	p: Placeable,
	x: number,
	y: number,
): { kind: 'entity'; entity: Entity } | { kind: 'npc'; npc: Npc } | undefined {
	if (p.kind === 'monster') {
		const m = catalogs.monsters.find((e) => e.id === p.id);
		if (!m) return undefined;
		return { kind: 'entity', entity: spawnMonster(m.behavior, -1, x, y) };
	}
	if (p.kind === 'npc') {
		const n = catalogs.npcs.find((e) => e.id === p.id);
		if (!n) return undefined;
		return {
			kind: 'npc',
			npc: {
				id: -1,
				kind: n.kind,
				name: n.name,
				x,
				y,
				w: NPC_BOX.w,
				h: NPC_BOX.h,
			},
		};
	}
	return undefined;
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

/** How far below the feet ground-snap will reach, in cells (#117). A surface
 *  farther than this reads as "not nearby ground", so the box stays where the
 *  author aimed (airborne) rather than falling to a distant floor. Tuned by feel. */
const MAX_SNAP_DROP = 3;

/**
 * Auto-ground-snap (#96): drop an entity's anchor so its feet rest on the nearest
 * solid surface at or below the cursor. Scans the footprint columns downward for the
 * first solid row — a `#` cell or the implicit canvas floor — and seats the box just
 * above it. An already-grounded anchor (or a Placeable with no surface below, or
 * terrain) is returned unchanged. The shell offers a free-place modifier that
 * bypasses this to drop exactly at the cursor (incl. mid-air).
 *
 * Snap should feel like "settle onto nearby ground", not "fall to the floor"
 * (#117): the scan reaches at most {@link MAX_SNAP_DROP} cells below the feet, so
 * a cursor held high above any surface keeps the author's feet anchor (airborne)
 * instead of teleporting down to a distant surface or the implicit world floor.
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
	// The first solid row at or below the box's current bottom edge, but no
	// farther than the snap cap — beyond it the box stays at the feet anchor.
	const limit = Math.min(ext.h, y + box.h + MAX_SNAP_DROP);
	for (let r = y + box.h; r <= limit; r++) {
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

// --- Center-origin placement + footprint hit-test (#114) -----------------------

/** The renderer's entity draw order (render.ts): monsters draw last and sit on
 *  top, then NPCs, then portals. A higher rank means "in front" on overlap. */
const ENTITY_LAYER: Record<Placeable['kind'], number> = {
	monster: 3,
	npc: 2,
	portal: 1,
	terrain: 0,
};

/**
 * Convert a CENTER-origin cursor to the stored TOP-LEFT glyph anchor (ADR 0008).
 * The cursor tracks the sprite's visual centre horizontally — `x = cx - floor(w/2)`
 * always — while the existing free-place toggle owns the vertical anchor AND the
 * snap, so there is never a per-cell auto-jump:
 *   - free-place ON  → the box is centred on the cursor (`cy - floor(h/2)`), dropped
 *     exactly where aimed (incl. mid-air).
 *   - free-place OFF → the cursor is the entity's feet (`cy - (h-1)`), then
 *     `groundSnap` drops the box onto the nearest surface at or below it.
 * One conversion shared by the ghost preview, `stampAt`, and the erase hit-test so
 * none of them can drift from where the glyph actually lands. Terrain (1×1) maps
 * the cursor straight through to the anchor. Zero file-format/engine change.
 */
export function cursorToAnchor(
	doc: EditorDoc,
	p: Placeable,
	cx: number,
	cy: number,
	freePlace: boolean,
): Point {
	const { w, h } = footprintBox(p, 0, 0);
	const x = cx - Math.floor(w / 2);
	if (freePlace) return { x, y: cy - Math.floor(h / 2) };
	return groundSnap(doc, p, x, cy - (h - 1));
}

/** An entity glyph located by a footprint hit-test: its stored top-left origin and
 *  the resolved Placeable. */
export interface EntityHit {
	originX: number;
	originY: number;
	placeable: Placeable;
}

/**
 * The renderer-topmost entity whose footprint covers `(x, y)`, or `undefined`.
 * Entities store only their origin glyph, so the rest of the footprint is empty
 * grid — this reverse-lookup scans every placed entity glyph (row-major, as
 * `parseZone` does), keeps those whose `footprintBox` contains the cell, and
 * returns the one the author sees on top: ordered by render layer
 * (monster > npc > portal), then larger anchor `y` (drawn later → in front), then
 * later in the scan. Deterministic from the doc and survives save/reload. The one
 * shared hit-test behind erase-anywhere now, and move + edit-on-click (#97) later.
 * Terrain is not an entity (it has no footprint to grab).
 */
export function entityAt(
	doc: EditorDoc,
	x: number,
	y: number,
): EntityHit | undefined {
	const ext = editorExtent(doc);
	const hits: { hit: EntityHit; scan: number }[] = [];
	let scan = 0;
	for (let oy = 0; oy < ext.h; oy++)
		for (let ox = 0; ox < ext.w; ox++) {
			const p = placeableAt(doc, ox, oy);
			if (!p || p.kind === 'terrain') continue;
			const order = scan++;
			const b = footprintBox(p, ox, oy);
			if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
				hits.push({
					hit: { originX: ox, originY: oy, placeable: p },
					scan: order,
				});
		}
	if (hits.length === 0) return undefined;
	hits.sort(
		(a, b) =>
			ENTITY_LAYER[b.hit.placeable.kind] - ENTITY_LAYER[a.hit.placeable.kind] ||
			b.hit.originY - a.hit.originY ||
			b.scan - a.scan,
	);
	return hits[0].hit;
}

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

// Editor frame geometry. The scene fills the buffer; the rulers + footer overpaint
// its edges, so the visible canvas is the inset region.
const RULER_H = 1; // top column ruler
const GUTTER_W = 4; // left row ruler (up to 3 digits + tick)
const FOOTER_H = 3; // tool bar + status line + stamp/hint line
const NAME_MAX = 48; // display-name length cap in the editor's name prompt (#99)
const SCROLLOFF = 4; // edit-scroll margin before the viewport follows
const ROAM_MARGIN = 16; // virgin space the cursor may roam past the content

/** Terrain is the only non-entity Placeable, so Brush/Rectangle/Line just paint it
 *  (no selector). Entities are chosen in the Stamp tool's modal picker (#114). */
const TERRAIN: Placeable = { kind: 'terrain' };

/** One entity the Stamp picker can place, with its display label and group. */
interface PickerEntry {
	label: string;
	group: string;
	placeable: Placeable;
}

/** The placeholder Portal a picker row carries (#97). A Portal is data-carrying —
 *  its real `target`/`arrival` come from the config form — so picking this row puts
 *  the editor into "place a portal" mode; the actual placement happens on form
 *  commit. `stampAt` detects the portal kind and opens the form instead of stamping. */
const PORTAL_SENTINEL: Placeable = {
	kind: 'portal',
	target: '',
	arrival: [0, 0],
};

/** The Stamp picker's entries: the catalog Monsters + NPCs, plus the Structures'
 *  Portal (#97). Terrain is implicit. Group labels are kept for the modal's section
 *  headers. */
function entityPalette(catalogs: Catalogs): PickerEntry[] {
	const entries = buildPalette(catalogs)
		.filter((g) => g.label === 'Monsters' || g.label === 'NPCs')
		.flatMap((g) =>
			g.items.flatMap((i) =>
				i.placeable
					? [{ label: i.label, group: g.label, placeable: i.placeable }]
					: [],
			),
		);
	entries.push({
		label: 'Portal',
		group: 'Structures',
		placeable: PORTAL_SENTINEL,
	});
	return entries;
}

/**
 * The Portal config form's live state (#97), or `null` when closed. The author
 * first chooses a `target` Zone (autocompleted from `query`), then edits the
 * `arrival` text — committing places (or, in `edit` mode, re-places) the Portal.
 * Shell state; the modal is eyeball-only per the PRD, its decisions are the pure
 * `portalForm` helpers.
 */
interface PortalForm {
	stage: 'target' | 'arrival';
	anchor: Point; // top-left glyph cell the Portal will occupy
	edit: Point | null; // origin of an existing Portal being edited (erased on commit)
	query: string; // typed target filter (target stage)
	target: string; // chosen target Zone id
	selIdx: number; // highlighted row in the filtered candidate list
	arrivalText: string; // the arrival field's editable text
}

/**
 * `zone edit <id>`: mount the entity-centric editor over an authored Zone. A
 * single crosshair cursor roams a free-growing canvas with wasd / vim (hjkl) /
 * arrow keys. Six modal Tools drive the canvas (#114): Brush/Rectangle/Line paint
 * terrain only, Eraser removes whatever entity or terrain the cursor covers, Stamp
 * opens a modal picker then places the chosen entity (center-origin, ground-snapped),
 * and Select captures a region for copy (`c`) / cut (`x`) / paste (`y`) / delete.
 * Tools switch by mnemonic key, `1`-`6`, or a click on the tool bar; with a mouse,
 * click/drag drives the cursor and middle-mouse free-pans the camera — but every
 * Tool is fully reachable with no mouse (SSH/tmux parity). `f` toggles ground-snap
 * vs. free-place, `^s` saves (trimming the trailing empties), `q` quits. The rulers,
 * crosshair, status/tool bars and Stamp picker are drawn here and validated by eye
 * (PRD); all geometry comes from the pure helpers above. Reuses the shared renderer
 * (#56) and the lossless `EditorDoc`, so nothing is lost on a round-trip.
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
	// Undo/redo history (#98): past/present/future over `EditorDoc` snapshots. Every
	// edit funnels through `commit`; a drag stroke coalesces into one step via a
	// per-stroke `strokeTag`, single-key edits pass none (always their own step).
	let history = initHistory(doc);
	let strokeTag: string | null = null; // non-null only mid mouse brush/eraser stroke
	let strokeSeq = 0; // makes each stroke's coalesce tag unique
	const cursor = { x: 0, y: 0 };
	const cam: Cam = { x: 0, y: 0 };
	const picker = entityPalette(catalogs); // entities the Stamp tool can place
	// The Portal config form (#97) needs the rest of the Zone set: the candidate
	// targets (so a Portal can never name a nonexistent Zone) and each target's
	// parsed Zone (to seed the default arrival from its return portal). Parse failures
	// are excluded — they can't be a valid target anyway.
	const zoneSet = loadZoneSet(deps.root, catalogs).flatMap((l) =>
		l.zone ? [l.zone] : [],
	);
	const portalCands: PortalCandidate[] = portalCandidates(zoneSet, id);
	const zoneById = new Map<string, Zone>(zoneSet.map((z) => [z.id, z]));
	let portalForm: PortalForm | null = null; // the open config form, or null
	let stampP: Placeable | undefined; // the entity Stamp will place (picked in the modal)
	let stampLabel = ''; // its display label (for the hint line)
	let pickerOpen = false; // the Stamp modal is capturing input
	let pickerIdx = 0; // highlighted row in the picker
	let toolIdx = 0; // active Tool (defaults to Brush)
	let anchor: Point | null = null; // in-progress drag gesture start (rect/line/select)
	let selection: { a: Point; b: Point } | null = null; // captured Select region
	let clip: Clip | null = null; // copy/cut buffer
	let panned = false; // middle-mouse free pan detached the camera from the cursor
	let freePlace = false; // `f` drops entities at the cursor instead of ground-snapping
	let savedText = serializeDoc(trimDoc(doc));
	let dirty = false;
	let diags = docDiagnostics(doc, catalogs, id);
	let scene = sceneOf(loaded.zone); // last-good scene; kept on a parse failure
	let quitPrompt = false; // quit-with-unsaved modal: [S]ave / [D]iscard / [Esc] cancel
	let namePrompt: string | null = null; // name-edit modal buffer (null = closed)
	let pendingTownToggle = false; // Field→Town toggle awaiting data-loss confirm
	let diagPanel = false; // diagnostics drill-down panel (#100) is open
	let diagIdx = 0; // highlighted diagnostic row

	// Footer hit-test spans, recomputed each frame so mouse clicks select the Tool
	// under the pointer (keyboard parity is the canonical path). The Stamp picker's
	// rows get their own hit-test while it is open.
	let frameW = 0;
	let frameH = 0;
	let toolHits: { x0: number; x1: number; idx: number }[] = [];
	let pickerHits: { x0: number; x1: number; y: number; idx: number }[] = [];

	const recompute = () => {
		dirty = serializeDoc(trimDoc(doc)) !== savedText;
		diags = docDiagnostics(doc, catalogs, id);
		try {
			scene = sceneOf(parseZone(serializeDoc(doc), catalogs, id));
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

			// Ghost preview (#96/#114/#118): while the Stamp tool holds a picked
			// entity, preview the actual entity that will land — its real sprite art,
			// every glyph kept, each colour faded onto the placement-state tint — at
			// the spot it will actually land. The cursor is the sprite's CENTER
			// (or feet when ground-snapping): one `cursorToAnchor` conversion feeds
			// the ghost, the stamp, and the erase hit-test, so it can't drift from
			// where the glyph lands. The placement state tints the glyph background —
			// green grounded, blue airborne, red clipping/off-canvas.
			const ghostP = stampP;
			if (ghostP && TOOLS[toolIdx].id === 'stamp' && !anchor) {
				const a = cursorToAnchor(doc, ghostP, cursor.x, cursor.y, freePlace);
				const st = placementState(doc, ghostP, a.x, a.y);
				const bg =
					st === 'grounded'
						? C.ghostOk
						: st === 'airborne'
							? C.ghostAir
							: C.ghostBad;
				// Fade each sprite colour by compositing it onto the placement-state
				// tint at GHOST_OPACITY, so the ghost reads as a translucent preview of
				// the REAL entity — same glyphs, faded colours — instead of swapping
				// each glyph for a lighter character (which garbled puzzle-shape blocks).
				const b = bg.toInts();
				const fade = (fg?: typeof C.selBg): typeof C.selBg | undefined => {
					if (!fg) return fg;
					const f = fg.toInts();
					const mix = (i: number) =>
						Math.round(f[i] * GHOST_OPACITY + b[i] * (1 - GHOST_OPACITY));
					return RGBA.fromInts(mix(0), mix(1), mix(2), 255);
				};
				const ghostStyle: GhostStyle<typeof C.selBg | undefined> = {
					bg,
					fade,
				};
				// Draw the synthesized entity through the SHARED renderer with the same
				// chrome-inset camera renderZoneScene uses, so the ghost sits exactly
				// where the placed entity would render. Kinds with no sprite yet
				// (portals, #97) fall back to a ░-filled footprint box.
				const sceneCam = { x: cam.x - GUTTER_W, y: cam.y - RULER_H };
				const ghost = ghostEntity(catalogs, ghostP, a.x, a.y);
				if (ghost?.kind === 'entity') {
					drawEntitySprite(buf, ghost.entity, sceneCam, style, ghostStyle);
				} else if (ghost?.kind === 'npc') {
					drawNpcSprite(buf, ghost.npc, sceneCam, style, ghostStyle);
				} else {
					const box = footprintBox(ghostP, a.x, a.y);
					for (let wy = box.y; wy < box.y + box.h; wy++)
						for (let wx = box.x; wx < box.x + box.w; wx++) {
							const px = sx(wx);
							const py = sy(wy);
							if (inCanvasX(px) && inCanvasY(py))
								buf.setCell(px, py, GHOST_GLYPH, C.cursorFg, bg);
						}
				}
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
			// Right of the tool bar: the Stamp placement-mode badge (#96), or — when
			// not actively stamping — a persistent Zone identity readout (#99) so the
			// author always sees the display name + type they're editing.
			if (TOOLS[toolIdx].id === 'stamp' && stampP) {
				const badge = freePlace ? 'free-place (f)' : 'ground-snap (f)';
				const bx = Math.max(tx + 1, W - badge.length);
				if (bx < W) buf.drawText(badge, bx, toolbarRow, C.dimFg, C.chromeBg);
			} else {
				const nm = zoneName(doc);
				const readout = `${nm ? `"${nm}" · ` : ''}${zoneType(doc)} (t)`;
				const bx = Math.max(tx + 1, W - readout.length);
				if (bx < W) buf.drawText(readout, bx, toolbarRow, C.dimFg, C.chromeBg);
			}

			// Status bar (reflects the active Tool; entity = the picked Stamp, if any).
			const statusRow = H - 2;
			buf.fillRect(0, statusRow, W, 1, C.chromeBg);
			const isStamp = TOOLS[toolIdx].id === 'stamp';
			const status = editorStatusLine({
				tool: TOOLS[toolIdx].label,
				placeable: isStamp ? stampLabel || '— pick (p)' : 'Terrain',
				cursor,
				dirty,
				diags,
			});
			buf.drawText(status.slice(0, W), 0, statusRow, C.textFg, C.chromeBg);

			// Hint line: context help (the bottom palette bar + `tab` are retired, #114).
			const hintRow = H - 1;
			buf.fillRect(0, hintRow, W, 1, C.chromeBg);
			const hint = isStamp
				? stampP
					? `Stamp: ${stampLabel} · space/click place · p re-pick`
					: 'Stamp: press p (or click the tool) to pick an entity'
				: 'Brush/Rect/Line terrain · Eraser removes · Stamp (p) entities · n name · t type · i issues';
			buf.drawText(hint.slice(0, W), 0, hintRow, C.dimFg, C.chromeBg);
			const px = Math.min(hint.length + 2, W - 1);
			// Field→Town data-loss confirm (#99): a second `t` applies, Esc cancels.
			if (pendingTownToggle && px < W)
				buf.drawText(
					`  → town: ${placedMonsterCount(doc)} monster(s) become invalid — t to confirm, Esc cancel`,
					px,
					hintRow,
					C.hot,
					C.chromeBg,
				);

			// Stamp entity-picker modal (#114): a bordered panel (the `drawOverheadBox`
			// pattern from playfield.ts) over the canvas, grouped Monsters / NPCs, the
			// highlighted row bracketed. Drawn LAST so it sits on top; its rows are
			// hit-tested for a mouse click. Keys are captured by `pickerOpen` early-return.
			pickerHits = [];
			if (pickerOpen) {
				const rows: { text: string; idx: number; header: boolean }[] = [];
				let group = '';
				for (let i = 0; i < picker.length; i++) {
					if (picker[i].group !== group) {
						group = picker[i].group;
						rows.push({ text: group, idx: -1, header: true });
					}
					rows.push({ text: picker[i].label, idx: i, header: false });
				}
				const title = ' Pick an entity ';
				const innerW = Math.max(
					title.length,
					...rows.map((r) => r.text.length + 4),
					18,
				);
				const boxW = innerW + 2;
				const boxH = rows.length + 3; // title row + rows + 2 borders
				const ox = Math.max(0, Math.floor((W - boxW) / 2));
				const oy = Math.max(RULER_H, Math.floor((H - boxH) / 2));
				const line = (s: string) => (s + ' '.repeat(boxW)).slice(0, boxW);
				buf.fillRect(ox, oy, boxW, boxH, C.chromeBg);
				buf.drawText(
					line(`┌${title}${'─'.repeat(boxW - 2 - title.length)}┐`),
					ox,
					oy,
					C.tickFg,
					C.chromeBg,
				);
				let ry = oy + 1;
				for (const r of rows) {
					if (r.header) {
						buf.drawText(line(`│ ${r.text}`), ox, ry, C.dimFg, C.chromeBg);
						buf.setCell(ox + boxW - 1, ry, '│', C.tickFg, C.chromeBg);
					} else {
						const active = r.idx === pickerIdx;
						const num = r.idx < 9 ? `${r.idx + 1} ` : '  ';
						const label = `${num}${r.text}`;
						const seg = active ? `[${label}]` : ` ${label} `;
						buf.setCell(ox, ry, '│', C.tickFg, C.chromeBg);
						buf.drawText(
							`  ${seg}`.slice(0, boxW - 2),
							ox + 1,
							ry,
							active ? C.hot : C.textFg,
							C.chromeBg,
						);
						buf.setCell(ox + boxW - 1, ry, '│', C.tickFg, C.chromeBg);
						pickerHits.push({ x0: ox, x1: ox + boxW, y: ry, idx: r.idx });
					}
					ry++;
				}
				buf.drawText(
					line(`└${'─'.repeat(boxW - 2)}┘`),
					ox,
					ry,
					C.tickFg,
					C.chromeBg,
				);
				ry++;
				const foot = ' ↑/↓ jk · Enter · 1-9 · Esc ';
				if (ry < oy + boxH + 1)
					buf.drawText(foot.slice(0, boxW), ox, oy + boxH, C.dimFg, C.chromeBg);
			}

			// Name-edit modal (#99): a single-line text field with a caret. Drawn last
			// so it floats over everything; keys are captured by the `namePrompt`
			// early-return in the keypress handler.
			if (namePrompt !== null) {
				const title = ' Zone display name ';
				const field = `${namePrompt}▏`;
				const innerW = Math.max(title.length, field.length + 2, 28);
				const boxW = innerW + 2;
				const ox = Math.max(0, Math.floor((W - boxW) / 2));
				const oy = Math.max(RULER_H, Math.floor((H - 4) / 2));
				const line = (s: string) => (s + ' '.repeat(boxW)).slice(0, boxW);
				buf.fillRect(ox, oy, boxW, 4, C.chromeBg);
				buf.drawText(
					line(`┌${title}${'─'.repeat(Math.max(0, boxW - 2 - title.length))}┐`),
					ox,
					oy,
					C.tickFg,
					C.chromeBg,
				);
				buf.setCell(ox, oy + 1, '│', C.tickFg, C.chromeBg);
				buf.drawText(
					` ${field}`.slice(0, boxW - 2),
					ox + 1,
					oy + 1,
					C.textFg,
					C.chromeBg,
				);
				buf.setCell(ox + boxW - 1, oy + 1, '│', C.tickFg, C.chromeBg);
				buf.setCell(ox, oy + 2, '│', C.tickFg, C.chromeBg);
				buf.drawText(
					' Enter save · Esc cancel · blank clears'.slice(0, boxW - 2),
					ox + 1,
					oy + 2,
					C.dimFg,
					C.chromeBg,
				);
				buf.setCell(ox + boxW - 1, oy + 2, '│', C.tickFg, C.chromeBg);
				buf.drawText(
					line(`└${'─'.repeat(boxW - 2)}┘`),
					ox,
					oy + 3,
					C.tickFg,
					C.chromeBg,
				);
			}

			// Quit-with-unsaved modal (#98): a real three-way choice (drawn last, on
			// top). Replaces the old "press q twice to discard" footgun.
			if (quitPrompt) {
				const title = ' Unsaved changes ';
				const choices = ' [S]ave & quit · [D]iscard · [Esc] cancel ';
				const innerW = Math.max(title.length, choices.length, 28);
				const boxW = innerW + 2;
				const ox = Math.max(0, Math.floor((W - boxW) / 2));
				const oy = Math.max(RULER_H, Math.floor((H - 4) / 2));
				const line = (s: string) => (s + ' '.repeat(boxW)).slice(0, boxW);
				buf.fillRect(ox, oy, boxW, 4, C.chromeBg);
				buf.drawText(
					line(`┌${title}${'─'.repeat(Math.max(0, boxW - 2 - title.length))}┐`),
					ox,
					oy,
					C.hot,
					C.chromeBg,
				);
				buf.setCell(ox, oy + 1, '│', C.hot, C.chromeBg);
				buf.drawText(
					' This Zone has unsaved edits.'.slice(0, boxW - 2),
					ox + 1,
					oy + 1,
					C.textFg,
					C.chromeBg,
				);
				buf.setCell(ox + boxW - 1, oy + 1, '│', C.hot, C.chromeBg);
				buf.setCell(ox, oy + 2, '│', C.hot, C.chromeBg);
				buf.drawText(
					choices.slice(0, boxW - 2),
					ox + 1,
					oy + 2,
					C.hot,
					C.chromeBg,
				);
				buf.setCell(ox + boxW - 1, oy + 2, '│', C.hot, C.chromeBg);
				buf.drawText(
					line(`└${'─'.repeat(boxW - 2)}┘`),
					ox,
					oy + 3,
					C.hot,
					C.chromeBg,
				);
			}

			// Portal config form (#97): a floating modal, drawn last. The target stage
			// shows the typed filter + the autocompleted candidate Zones (highlighted
			// row bracketed); the arrival stage shows the chosen target + the editable
			// `x,y` field. Keys are captured by the `portalForm` early-return above.
			if (portalForm) {
				const f = portalForm;
				const verb = f.edit ? 'Edit' : 'New';
				const body: { text: string; hot?: boolean }[] = [];
				if (f.stage === 'target') {
					body.push({ text: `target: ${f.query}▏` });
					const cands = filterCandidates(portalCands, f.query);
					if (cands.length === 0) body.push({ text: ' (no matching Zone)' });
					for (let i = 0; i < cands.length && i < 8; i++) {
						const c = cands[i];
						const lbl = c.name ? `${c.id}  ${c.name}` : c.id;
						body.push({
							text: i === f.selIdx ? `[${lbl}]` : ` ${lbl} `,
							hot: i === f.selIdx,
						});
					}
					body.push({ text: ' ↑/↓ · Enter pick · Esc cancel' });
				} else {
					body.push({ text: `target: ${f.target}` });
					const ok = parseArrival(f.arrivalText) !== undefined;
					body.push({
						text: `arrival: ${f.arrivalText}▏${ok ? '' : '  (x,y)'}`,
					});
					body.push({ text: ' Enter save · Esc back' });
				}
				const title = ` ${verb} portal `;
				const innerW = Math.max(
					title.length,
					...body.map((b) => b.text.length + 2),
					30,
				);
				const boxW = innerW + 2;
				const boxH = body.length + 2;
				const ox = Math.max(0, Math.floor((W - boxW) / 2));
				const oy = Math.max(RULER_H, Math.floor((H - boxH) / 2));
				const line = (s: string) => (s + ' '.repeat(boxW)).slice(0, boxW);
				buf.fillRect(ox, oy, boxW, boxH, C.chromeBg);
				buf.drawText(
					line(`┌${title}${'─'.repeat(Math.max(0, boxW - 2 - title.length))}┐`),
					ox,
					oy,
					C.tickFg,
					C.chromeBg,
				);
				let ry = oy + 1;
				for (const b of body) {
					buf.setCell(ox, ry, '│', C.tickFg, C.chromeBg);
					buf.drawText(
						` ${b.text}`.slice(0, boxW - 2),
						ox + 1,
						ry,
						b.hot ? C.hot : C.textFg,
						C.chromeBg,
					);
					buf.setCell(ox + boxW - 1, ry, '│', C.tickFg, C.chromeBg);
					ry++;
				}
				buf.drawText(
					line(`└${'─'.repeat(boxW - 2)}┘`),
					ox,
					ry,
					C.tickFg,
					C.chromeBg,
				);
			}

			// Diagnostics drill-down panel (#100): the live `diags` (the same findings
			// `zone check` emits, recomputed on every edit) listed in full, the selected
			// row bracketed and a `→` marking the navigable ones. Drawn last; keys are
			// captured by the `diagPanel` early-return. The status badge stays the
			// always-on signal — this is the opt-in detail view.
			if (diagPanel) {
				diagIdx = clampDiagIndex(diagIdx, diags.length);
				const title = ' Diagnostics ';
				const summary = diagPanelSummary(diags);
				const rowsTxt = diags.map(
					(d) => `${diagJumpTarget(d) ? '→ ' : '  '}${formatDiagLine(d)}`,
				);
				const foot = ' ↑/↓ jk · Enter jump · Esc/i close ';
				const innerW = Math.min(
					Math.max(
						title.length,
						summary.length + 2,
						foot.length,
						...rowsTxt.map((t) => t.length + 2),
						24,
					),
					Math.max(8, W - 2),
				);
				const boxW = innerW + 2;
				const boxH = rowsTxt.length + 3; // title + summary + rows + bottom border
				const ox = Math.max(0, Math.floor((W - boxW) / 2));
				const oy = Math.max(RULER_H, Math.floor((H - boxH - 1) / 2));
				const line = (s: string) => (s + ' '.repeat(boxW)).slice(0, boxW);
				buf.fillRect(ox, oy, boxW, boxH + 1, C.chromeBg);
				buf.drawText(
					line(`┌${title}${'─'.repeat(boxW - 2 - title.length)}┐`),
					ox,
					oy,
					C.tickFg,
					C.chromeBg,
				);
				buf.setCell(ox, oy + 1, '│', C.tickFg, C.chromeBg);
				buf.drawText(
					` ${summary}`.slice(0, boxW - 2),
					ox + 1,
					oy + 1,
					C.dimFg,
					C.chromeBg,
				);
				buf.setCell(ox + boxW - 1, oy + 1, '│', C.tickFg, C.chromeBg);
				let ry = oy + 2;
				for (let i = 0; i < rowsTxt.length; i++) {
					const active = i === diagIdx;
					const seg = active ? `[${rowsTxt[i]}]` : ` ${rowsTxt[i]} `;
					const fg = active
						? C.hot
						: diags[i].severity === 'error'
							? C.textFg
							: C.dimFg;
					buf.setCell(ox, ry, '│', C.tickFg, C.chromeBg);
					buf.drawText(seg.slice(0, boxW - 2), ox + 1, ry, fg, C.chromeBg);
					buf.setCell(ox + boxW - 1, ry, '│', C.tickFg, C.chromeBg);
					ry++;
				}
				buf.drawText(
					line(`└${'─'.repeat(boxW - 2)}┘`),
					ox,
					ry,
					C.tickFg,
					C.chromeBg,
				);
				buf.drawText(foot.slice(0, boxW), ox, ry + 1, C.dimFg, C.chromeBg);
			}
		}
	}

	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
		useMouse: true,
		// Kitty keyboard protocol (#98): lets the terminal report the Cmd (`super`)
		// modifier and shifted keys, so Cmd-Z / Cmd-Shift-Z and Shift-U undo/redo are
		// distinguishable. Terminals that don't speak it ignore the enable sequence and
		// fall back to legacy parsing (the bare `u`/`U` path still works either way).
		useKittyKeyboard: {},
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

	// Apply an edit: swap in the new doc, record it on the history (coalescing into
	// the current step when `tag` matches, e.g. a brush stroke), and recompute. The
	// single funnel every mutation goes through so undo/redo can never miss one.
	const commit = (next: EditorDoc, tag?: string) => {
		doc = next;
		history = record(history, doc, tag);
		recompute();
	};
	// Undo / redo (#98): restore the snapshot and drop any in-progress gesture so the
	// view can't reference a cell from the reverted state. `dirty` is derived in
	// recompute, so it tracks back to clean when we land on the saved snapshot.
	const doUndo = () => {
		if (!canUndo(history)) return;
		history = undo(history);
		doc = history.present;
		anchor = null;
		selection = null;
		recompute();
	};
	const doRedo = () => {
		if (!canRedo(history)) return;
		history = redo(history);
		doc = history.present;
		anchor = null;
		selection = null;
		recompute();
	};

	const activeTool = () => TOOLS[toolIdx];

	// Open / close the Stamp picker. Selecting the Stamp tool with no entity yet
	// opens it automatically; confirming keeps the tool active for "pick once, stamp
	// many". An empty catalog (no entities to pick) never opens.
	const openPicker = () => {
		if (picker.length === 0) return;
		pickerOpen = true;
		const cur = picker.findIndex((e) => e.placeable === stampP);
		pickerIdx = cur >= 0 ? cur : 0;
	};
	const confirmPicker = (i: number) => {
		if (i >= 0 && i < picker.length) {
			stampP = picker[i].placeable;
			stampLabel = picker[i].label;
		}
		pickerOpen = false;
	};

	// Paint terrain `#` at a cell (Brush / Rectangle / Line are terrain-only, #114).
	// `strokeTag` is set only during a mouse drag, so a stroke is one undo step while
	// each keyboard press is its own.
	const paintAt = (x: number, y: number) => {
		commit(
			place(growToInclude(doc, x, y), x, y, TERRAIN),
			strokeTag ?? undefined,
		);
	};
	// The filtered target candidates for the form's current query (target stage).
	const formCandidates = (): PortalCandidate[] =>
		portalForm ? filterCandidates(portalCands, portalForm.query) : [];

	// Open the Portal config form (#97). For a NEW portal, `edit` is null and the
	// anchor is where the ghost sits; for an EDIT, `edit` is the existing origin and
	// the form is seeded with its current target + arrival. With no candidate Zones
	// to target, the form can't resolve, so it never opens.
	const openPortalForm = (
		anchor: Point,
		edit: Point | null,
		seed?: { target: string; arrival: Arrival },
	) => {
		if (portalCands.length === 0) return;
		const sel = seed
			? Math.max(
					0,
					filterCandidates(portalCands, '').findIndex(
						(c) => c.id === seed.target,
					),
				)
			: 0;
		portalForm = {
			stage: 'target',
			anchor,
			edit,
			query: '',
			target: seed?.target ?? '',
			selIdx: sel,
			arrivalText: seed ? formatArrival(seed.arrival) : '',
		};
	};

	// Commit the Portal form: build the data-carrying Placeable and stamp it at the
	// anchor. An edit first erases the old origin so a changed target/arrival doesn't
	// leave a stale glyph (place then re-declares). Stays open on a malformed arrival.
	const commitPortalForm = () => {
		if (!portalForm) return;
		const arrival = parseArrival(portalForm.arrivalText);
		if (!portalForm.target || !arrival) return;
		const p: Placeable = {
			kind: 'portal',
			target: portalForm.target,
			arrival,
		};
		const a = portalForm.anchor;
		if (portalForm.edit) doc = erase(doc, portalForm.edit.x, portalForm.edit.y);
		doc = place(growToInclude(doc, a.x, a.y), a.x, a.y, p);
		portalForm = null;
		recompute();
	};

	// Stamp the picked entity: the cursor is its CENTER, converted to the stored
	// top-left anchor (ground-snapped unless free-place) by the shared `cursorToAnchor`.
	// A Portal is data-carrying — instead of stamping, it opens the config form (#97)
	// at the landing anchor.
	const stampAt = (x: number, y: number) => {
		if (!stampP) return openPicker();
		const a = cursorToAnchor(doc, stampP, x, y, freePlace);
		if (stampP.kind === 'portal') return openPortalForm(a, null);
		commit(place(growToInclude(doc, a.x, a.y), a.x, a.y, stampP));
	};
	// Erase whatever the cell covers: the topmost entity whose footprint contains it
	// (removed at its origin), else the exact cell — so any part of a sprite erases it.
	const eraseAt = (x: number, y: number) => {
		const hit = entityAt(doc, x, y);
		const next = hit ? erase(doc, hit.originX, hit.originY) : erase(doc, x, y);
		commit(next, strokeTag ?? undefined);
	};

	// Edit-on-click (#97): if the cell holds a data-carrying Portal, re-open its
	// config form (seeded with the current target + arrival) and report it handled.
	// Plain Monsters/NPCs carry no data, so they fall through to move/delete.
	const tryEditPortal = (x: number, y: number): boolean => {
		const hit = entityAt(doc, x, y);
		if (hit?.placeable.kind !== 'portal') return false;
		openPortalForm(
			{ x: hit.originX, y: hit.originY },
			{ x: hit.originX, y: hit.originY },
			{
				target: hit.placeable.target,
				arrival: hit.placeable.arrival,
			},
		);
		return true;
	};

	// The Tool's primary action at the cursor (`space`/click). Drag tools toggle
	// the anchor (press A, then press B to commit); the rest act immediately.
	const toolPrimary = () => {
		const t = activeTool();
		if (t.id === 'brush') return paintAt(cursor.x, cursor.y);
		if (t.id === 'eraser') return eraseAt(cursor.x, cursor.y);
		if (t.id === 'stamp') return stampAt(cursor.x, cursor.y);
		// Select: a press on a Portal opens its form (edit-on-click); otherwise it
		// anchors a region (first press) then commits the selection (second press).
		if (t.id === 'select' && !anchor && tryEditPortal(cursor.x, cursor.y))
			return;
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
		// Rectangle / Line paint terrain only (#114); Select captures the region.
		// Each is one atomic edit → one undo step (no per-cell coalescing needed).
		if (t.id === 'rectangle') {
			commit(paintCells(doc, rectCells(a, b), TERRAIN));
		} else if (t.id === 'line') {
			commit(paintCells(doc, lineCells(a, b), TERRAIN));
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
	let stampDrag = false; // an entity drag-place is in flight (commit one on release)

	view.onMouseDown = (e: { button: number; x: number; y: number }) => {
		pendingTownToggle = false;
		// While the quit modal (#98) or name prompt is open they own input — ignore
		// canvas/tool clicks so a stray click can't paint or dismiss them (the modal
		// resolves only via S/D/Esc; the prompt via Enter/Esc).
		if (quitPrompt || namePrompt !== null) return;
		// The Portal config form (#97) is keyboard-driven (like the name prompt) — a
		// stray canvas/tool click can't paint while it's open.
		if (portalForm) return;
		// The diagnostics panel (#100) is keyboard-driven too — ignore canvas clicks
		// while it's open so a stray click can't paint behind it.
		if (diagPanel) return;
		// The Stamp picker modal eats clicks: a row confirms, anywhere else cancels.
		if (pickerOpen) {
			const hit = pickerHits.find(
				(h) => e.y === h.y && e.x >= h.x0 && e.x < h.x1,
			);
			if (hit) confirmPicker(hit.idx);
			else pickerOpen = false;
			return;
		}
		if (e.button === 1) {
			panLast = { x: e.x, y: e.y }; // middle-mouse: begin free pan
			return;
		}
		if (e.button !== 0) return;
		// Tool bar clicks select the Tool (and open the picker for Stamp).
		if (e.y === frameH - FOOTER_H) {
			const hit = toolHits.find((h) => e.x >= h.x0 && e.x < h.x1);
			if (hit) {
				toolIdx = hit.idx;
				anchor = null;
				if (TOOLS[hit.idx].id === 'stamp' && !stampP) openPicker();
			}
			return;
		}
		if (!inCanvasRegion(e.x, e.y)) return;
		const w = toWorld(e.x, e.y);
		moveCursorTo(w.x, w.y);
		const t = activeTool();
		// Select-clicking a Portal opens its config form (edit-on-click, #97) rather
		// than starting a region drag; start the drag on empty space to select instead.
		if (t.id === 'select' && tryEditPortal(cursor.x, cursor.y)) return;
		// Drag tools anchor on down; Stamp picks up a ghost (commit one on release);
		// Brush/Eraser act immediately and drag-paint. A brush/eraser stroke opens a
		// fresh coalesce tag so the whole down→drag→up paint is one undo step.
		if (t.id === 'brush' || t.id === 'eraser')
			strokeTag = `stroke${++strokeSeq}`;
		if (t.drag) anchor = { x: cursor.x, y: cursor.y };
		else if (t.id === 'stamp') stampDrag = true;
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
		// Terrain Brush drag-paints continuously; Eraser drag-erases. Stamp's ghost
		// just trails the cursor (one entity on release); drag tools trail for the preview.
		if (activeTool().id === 'brush') paintAt(cursor.x, cursor.y);
		else if (activeTool().id === 'eraser') eraseAt(cursor.x, cursor.y);
	};

	const endDrag = (e: { button: number }) => {
		if (panLast && e.button === 1) {
			panLast = null;
			return;
		}
		// The brush/eraser stroke is over; the next stroke gets a fresh coalesce tag.
		strokeTag = null;
		// Stamp drag-place commits ONE entity at the release point (a plain click is a
		// zero-length drag → one placement).
		if (stampDrag) {
			stampDrag = false;
			stampAt(cursor.x, cursor.y);
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

	type EditKey = {
		name: string;
		ctrl: boolean;
		meta?: boolean;
		shift?: boolean;
		// macOS Cmd arrives as `super` (only over the Kitty keyboard protocol); Alt/
		// Option as `meta`/`option`. We treat any of them as the "command" modifier so
		// Cmd-Z works wherever the terminal forwards it.
		super?: boolean;
		option?: boolean;
		sequence?: string;
	};
	// Tear down opentui and exit. The single quit path, shared by the clean-quit `q`
	// and the [S]ave / [D]iscard choices of the unsaved-changes modal (#98).
	const doQuit = () => {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
		process.exit(0);
	};

	renderer.keyInput.on('keypress', (k: EditKey) => {
		const wasPendingTownToggle = pendingTownToggle;
		pendingTownToggle = false;

		// Quit-with-unsaved modal (#98) owns every key while open: a real three-way
		// choice — [S]ave & quit, [D]iscard & quit, [Esc] cancel — replacing the old
		// "press q twice to discard" footgun. Captured first, like the other modals.
		if (quitPrompt) {
			if (k.name === 'escape') quitPrompt = false;
			else if (k.name === 's') {
				save();
				doQuit();
			} else if (k.name === 'd') doQuit();
			return;
		}

		// The name-edit modal (#99) owns every key while open: printable chars extend
		// the buffer (sequence = the literal char, like ChatInput), Enter commits via
		// setZoneName, Esc cancels. Drawn last; captured here first.
		if (namePrompt !== null) {
			if (k.name === 'escape') {
				namePrompt = null;
			} else if (k.name === 'return' || k.name === 'enter') {
				commit(setZoneName(doc, namePrompt));
				namePrompt = null;
			} else if (k.name === 'backspace') {
				namePrompt = namePrompt.slice(0, -1);
			} else if (!k.ctrl && !k.meta) {
				const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
				if (
					ch.length === 1 &&
					ch >= ' ' &&
					ch !== '\x7f' &&
					namePrompt.length < NAME_MAX
				)
					namePrompt += ch;
			}
			return;
		}

		// The Portal config form (#97) owns every key while open. Two stages:
		//  - target: type to autocomplete the candidate Zones, ↑/↓ to highlight, Enter
		//    to choose (seeds the default arrival from the target's return portal),
		//    Esc to cancel the form.
		//  - arrival: edit the `x,y` text, Enter to commit (stays open if malformed),
		//    Esc to step back to the target stage.
		if (portalForm) {
			const f = portalForm;
			if (f.stage === 'target') {
				const cands = formCandidates();
				if (k.name === 'escape') {
					portalForm = null;
				} else if (k.name === 'up') {
					if (cands.length)
						f.selIdx = (f.selIdx - 1 + cands.length) % cands.length;
				} else if (k.name === 'down') {
					if (cands.length) f.selIdx = (f.selIdx + 1) % cands.length;
				} else if (k.name === 'return' || k.name === 'enter') {
					const chosen = cands[f.selIdx];
					if (chosen) {
						f.target = chosen.id;
						// Seed the arrival only when it's still blank (a fresh portal), so an
						// edit keeps the author's existing point unless they clear it.
						if (!f.arrivalText.trim()) {
							const tz = zoneById.get(chosen.id);
							if (tz) f.arrivalText = formatArrival(defaultArrival(tz, id));
						}
						f.stage = 'arrival';
					}
				} else if (k.name === 'backspace') {
					f.query = f.query.slice(0, -1);
					f.selIdx = 0;
				} else if (!k.ctrl && !k.meta) {
					const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
					if (ch.length === 1 && ch > ' ' && ch !== '\x7f') {
						f.query += ch;
						f.selIdx = 0;
					}
				}
			} else {
				if (k.name === 'escape') {
					f.stage = 'target';
				} else if (k.name === 'return' || k.name === 'enter') {
					commitPortalForm();
				} else if (k.name === 'backspace') {
					f.arrivalText = f.arrivalText.slice(0, -1);
				} else if (!k.ctrl && !k.meta) {
					// The arrival field accepts only the digits/comma/space `parseArrival` reads.
					const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
					if (ch.length === 1 && /[0-9, ]/.test(ch)) f.arrivalText += ch;
				}
			}
			return;
		}

		// The Stamp picker modal captures all keys while open (#114): navigate the
		// entity list, Enter / a digit confirms, Esc cancels — like `pendingQuit`.
		if (pickerOpen) {
			if (k.name === 'escape') {
				pickerOpen = false;
			} else if (k.name === 'up' || k.name === 'k') {
				pickerIdx = (pickerIdx - 1 + picker.length) % picker.length;
			} else if (k.name === 'down' || k.name === 'j') {
				pickerIdx = (pickerIdx + 1) % picker.length;
			} else if (
				k.name === 'return' ||
				k.name === 'enter' ||
				k.name === 'space'
			) {
				confirmPicker(pickerIdx);
			} else {
				const n = Number.parseInt(k.name, 10);
				if (String(n) === k.name && n >= 1 && n <= picker.length)
					confirmPicker(n - 1);
			}
			return;
		}

		// The diagnostics panel (#100) owns navigation while open: ↑/↓ (jk) move the
		// selection, Enter/space jumps the cursor to the offending cell (and closes),
		// Esc / i close. It's a drill-down over the live `diags`, never a blocking modal.
		if (diagPanel) {
			diagIdx = clampDiagIndex(diagIdx, diags.length);
			if (k.name === 'escape' || k.name === 'i') {
				diagPanel = false;
			} else if (k.name === 'up' || k.name === 'k') {
				if (diags.length) diagIdx = (diagIdx - 1 + diags.length) % diags.length;
			} else if (k.name === 'down' || k.name === 'j') {
				if (diags.length) diagIdx = (diagIdx + 1) % diags.length;
			} else if (
				k.name === 'return' ||
				k.name === 'enter' ||
				k.name === 'space'
			) {
				const target = diags[diagIdx] ? diagJumpTarget(diags[diagIdx]) : null;
				if (target) move(target.x - cursor.x, target.y - cursor.y);
				diagPanel = false;
			}
			return;
		}

		// Save is ^s so the bare `s` (and the rest of wasd) is free for movement.
		if (k.ctrl && k.name === 's') return save();

		// Undo / redo (#98). Bound on every modifier a terminal might forward, plus a
		// modifier-FREE pair so you're never stuck if Ctrl/Cmd is awkward:
		//   · `u` undo / `U` (Shift-U) redo — always available, no Ctrl needed.
		//   · Ctrl-Z undo, Ctrl-R / Ctrl-Y redo (vim-style).
		//   · Cmd-Z undo, Cmd-Shift-Z / Cmd-Y redo (macOS-native; needs a terminal that
		//     speaks the Kitty keyboard protocol — Ghostty, Kitty, WezTerm, iTerm2 cfg).
		// Checked BEFORE `toolByKey` so Ctrl/Cmd-R isn't read as the Rectangle tool.
		const cmd = k.super === true || k.meta === true || k.option === true;
		if ((k.ctrl || cmd) && k.name === 'z') return k.shift ? doRedo() : doUndo();
		if ((k.ctrl || cmd) && (k.name === 'r' || k.name === 'y')) return doRedo();
		// Bare-key fallbacks: `u` undo, Shift-U redo (or a literal uppercase 'U').
		if (k.name === 'u') return k.shift ? doRedo() : doUndo();
		if (k.sequence === 'U') return doRedo();

		// Tool selection (mnemonic letter or 1-6 digit). These never collide with a
		// movement key, so they're safe to intercept before the movement switch. The
		// Stamp tool (`p`/`6`) opens its picker — so re-pressing it re-picks the entity.
		const tool = toolByKey(k.name);
		if (tool) {
			toolIdx = TOOLS.indexOf(tool);
			anchor = null;
			if (tool.id === 'stamp') openPicker();
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
			case 'i': // open the diagnostics drill-down panel (#100); closing is handled above
				diagPanel = true;
				diagIdx = clampDiagIndex(diagIdx, diags.length);
				return;
			case 'n': // edit the Zone's display name (#99): open the prompt seeded with it
				namePrompt = zoneName(doc) ?? '';
				return;
			case 't': {
				// Toggle Zone type field↔town (#99). Switching a populated Field → Town
				// would invalidate its Monsters (Towns forbid spawns), so warn once and
				// require a second `t` to confirm; live validation backstops it either way.
				const target = zoneType(doc) === 'field' ? 'town' : 'field';
				if (
					target === 'town' &&
					placedMonsterCount(doc) > 0 &&
					!wasPendingTownToggle
				) {
					pendingTownToggle = true;
					return;
				}
				commit(setZoneType(doc, target));
				return;
			}
			case 'c': // Select → copy
				if (hasSelection() && selection)
					clip = copyRegion(doc, selection.a, selection.b);
				return;
			case 'y': // paste the clipboard at the cursor (any tool); `p` is the Stamp tool
				if (clip) commit(pasteClip(doc, clip, cursor.x, cursor.y));
				return;
			case 'x':
				// In Select with a region: cut (copy + clear) so a paste moves it.
				if (hasSelection() && selection) {
					clip = copyRegion(doc, selection.a, selection.b);
					commit(deleteRegion(doc, selection.a, selection.b));
					selection = null;
				} else {
					eraseAt(cursor.x, cursor.y);
				}
				return;
			case 'backspace':
			case 'delete':
				// In Select with a region: delete it; otherwise erase the cursor cell.
				if (hasSelection() && selection) {
					commit(deleteRegion(doc, selection.a, selection.b));
					selection = null;
				} else {
					eraseAt(cursor.x, cursor.y);
				}
				return;
			case 'q':
				// Unsaved changes open the explicit Save/Discard/Cancel modal (#98);
				// a clean buffer quits straight away.
				if (dirty) {
					quitPrompt = true;
					return;
				}
				doQuit();
		}
	});

	renderer.start();
}
