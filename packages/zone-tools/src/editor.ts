// The Zone editor's pure navigation + canvas core (ADR 0010, issue #94). The
// author moves a single crosshair cursor over a free-roaming, auto-growing canvas
// — painting into virgin space extends the inferred dimensions, deleting the far
// edge shrinks them back on save. This module owns the geometry (extent, grow,
// trim), the edit-scroll viewport (scrolloff), and the status line; the opentui
// shell at the bottom draws the rulers/crosshair/palette and is eyeball-only per
// the PRD. All geometry sits on top of the lossless `EditorDoc` (doc.ts).

import {
	buildSceneStyle,
	type Catalogs,
	type Diagnostic,
	findOrphanGlyphs,
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
 *  selections (Tool lands fully in #95; #94 ships a single Brush). */
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

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

// Editor frame geometry. The scene fills the buffer; the rulers + footer overpaint
// its edges, so the visible canvas is the inset region.
const RULER_H = 1; // top column ruler
const GUTTER_W = 4; // left row ruler (up to 3 digits + tick)
const FOOTER_H = 2; // status line + palette bar
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
 * arrow keys; `space` stamps the active Placeable (auto-growing the canvas into
 * virgin space), `x` erases, `tab` cycles the Placeable, `^s` saves (trimming the
 * trailing empties), `q` quits. The rulers, crosshair, status bar, and palette bar are drawn here and
 * validated by eye (PRD); all geometry comes from the pure helpers above. Reuses
 * the shared renderer (#56) and the lossless `EditorDoc`, so nothing is lost on a
 * round-trip. Long-lived: opentui owns the process lifecycle (ctrl-c / q exit).
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
	let savedText = serializeDoc(trimDoc(doc));
	let dirty = false;
	let diags = docDiagnostics(doc, catalogs);
	let scene = sceneOf(loaded.zone); // last-good scene; kept on a parse failure
	let pendingQuit = false;

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
	};

	class EditRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const W = buf.width;
			const H = buf.height;
			const viewW = Math.max(1, W - GUTTER_W);
			const viewH = Math.max(1, H - RULER_H - FOOTER_H);
			// Keep the cursor inside the scrolloff band (edit-scroll viewport).
			const next = scrollViewport(cam, cursor, viewW, viewH, SCROLLOFF);
			cam.x = next.x;
			cam.y = next.y;

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

			// Off-screen indicator (dormant until #95's free pan decouples cam/cursor).
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

			// Status bar.
			const statusRow = H - FOOTER_H;
			buf.fillRect(0, statusRow, W, 1, C.chromeBg);
			const status = editorStatusLine({
				tool: 'Brush',
				placeable: palette[selIdx]?.label ?? '—',
				cursor,
				dirty,
				diags,
			});
			buf.drawText(status.slice(0, W), 0, statusRow, C.textFg, C.chromeBg);

			// Palette bar: groups with the active Placeable bracketed + highlighted.
			const paletteRow = H - 1;
			buf.fillRect(0, paletteRow, W, 1, C.chromeBg);
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
	});
	renderer.root.add(new EditRenderable(renderer));

	const move = (dx: number, dy: number) => {
		const c = clampRoam(doc, cursor.x + dx, cursor.y + dy, ROAM_MARGIN);
		cursor.x = c.x;
		cursor.y = c.y;
	};

	const save = () => {
		savedText = serializeDoc(trimDoc(doc));
		writeZone(deps.root, id, savedText);
		dirty = false;
	};

	renderer.keyInput.on('keypress', (k: { name: string; ctrl: boolean }) => {
		const wasPendingQuit = pendingQuit;
		pendingQuit = false;
		// Save is ^s so the bare `s` (and the rest of wasd) is free for movement.
		if (k.ctrl && k.name === 's') return save();
		switch (k.name) {
			case 'left':
			case 'h':
			case 'a':
				return move(-1, 0);
			case 'right':
			case 'l':
			case 'd':
				return move(1, 0);
			case 'up':
			case 'k':
			case 'w':
				return move(0, -1);
			case 'down':
			case 'j':
			case 's':
				return move(0, 1);
			case 'space': {
				const p = palette[selIdx]?.placeable;
				if (p) {
					doc = place(
						growToInclude(doc, cursor.x, cursor.y),
						cursor.x,
						cursor.y,
						p,
					);
					recompute();
				}
				return;
			}
			case 'x':
			case 'backspace':
			case 'delete':
				doc = erase(doc, cursor.x, cursor.y);
				recompute();
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
