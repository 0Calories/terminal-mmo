import {
	buildSceneStyle,
	type Catalogs,
	type Diagnostic,
	findOrphanGlyphs,
	parseZone,
	renderZoneScene,
	validateZone,
	type ZoneScene,
} from '@mmo/shared';
// Type-only import is erased at compile time, so it never loads opentui's
// runtime — the pure helpers above stay testable without a terminal.
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import {
	cellAt,
	clearCell,
	type EditorDoc,
	parseDoc,
	placeGlyph,
	serializeDoc,
	toggleSolid,
} from './doc';
import { loadCatalogs, loadZone, writeZone } from './io';
import { followCam } from './play';
import { type Cam, sceneOf } from './preview';

// --- Pure helpers (unit-tested; the opentui shell below is manual per PRD) ----

/**
 * An undo stack of doc snapshots. Rows are tiny, so whole-doc snapshots are
 * cheap; `present` is the live doc, `past` the states to step back through.
 */
export interface EditHistory {
	past: EditorDoc[];
	present: EditorDoc;
}

/** Start a history at `doc` with nothing to undo. */
export function initHistory(doc: EditorDoc): EditHistory {
	return { past: [], present: doc };
}

/** Record the current present and make `next` the new present. */
export function commit(h: EditHistory, next: EditorDoc): EditHistory {
	return { past: [...h.past, h.present], present: next };
}

/** Step the present back one snapshot; a no-op at the initial state. */
export function undo(h: EditHistory): EditHistory {
	if (h.past.length === 0) return h;
	const past = h.past.slice();
	const present = past.pop() as EditorDoc;
	return { past, present };
}

/** The grid extent of a doc: width = longest row, height = row count. Rows may
 *  be ragged, so width is the max — the cursor can roam the whole canvas. */
export function gridSize(doc: EditorDoc): { w: number; h: number } {
	let w = 0;
	for (const r of doc.rows) if (r.length > w) w = r.length;
	return { w, h: doc.rows.length };
}

/** Clamp a cursor to the doc's grid; an empty grid pins it at the origin. */
export function clampCursor(
	doc: EditorDoc,
	x: number,
	y: number,
): { x: number; y: number } {
	const { w, h } = gridSize(doc);
	return {
		x: Math.max(0, Math.min(x, Math.max(0, w - 1))),
		y: Math.max(0, Math.min(y, Math.max(0, h - 1))),
	};
}

/**
 * The glyphs declared in the header (spawns/npcs/portals) — the set the editor
 * can stamp into the grid. Sorted + unique. MVP only places ALREADY-declared
 * glyphs; authoring new catalog refs / header keys stays a text edit (#84 scope).
 */
export function declaredGlyphs(doc: EditorDoc): string[] {
	const keys = new Set<string>();
	for (const group of ['spawns', 'npcs', 'portals'] as const) {
		const m = doc.header[group];
		if (m && typeof m === 'object')
			for (const k of Object.keys(m as Record<string, unknown>)) keys.add(k);
	}
	return [...keys].sort();
}

/**
 * Live diagnostics for the in-progress doc, the same way `zone check` will see it:
 * serialize, parse through the real `parseZone` (a failure becomes one parse
 * error), then run `validateZone` plus the raw-text orphan-key check. Pure — so
 * the editor's validation panel is unit-tested though its render is eyeball-only.
 */
export function docDiagnostics(
	doc: EditorDoc,
	catalogs: Catalogs,
): Diagnostic[] {
	const text = serializeDoc(doc);
	const zoneId = typeof doc.header.id === 'string' ? doc.header.id : '(zone)';
	try {
		const zone = parseZone(text, catalogs);
		return [...validateZone(zone, catalogs), ...findOrphanGlyphs(text)];
	} catch (e) {
		return [
			{
				severity: 'error',
				zoneId,
				message: `parse failed: ${(e as Error).message}`,
			},
		];
	}
}

/**
 * The one-line status header: Zone id (a `*` when unsaved), cursor cell, the
 * glyph the stamp key will place, and the live validation health (✓, or the
 * error count + first message), followed by the key hints.
 */
export function editStatusLine(
	doc: EditorDoc,
	cursor: { x: number; y: number },
	glyph: string,
	diags: Diagnostic[],
	dirty: boolean,
): string {
	const errs = diags.filter((d) => d.severity === 'error');
	const health =
		errs.length === 0 ? '✓' : `✗ ${errs.length}: ${errs[0].message}`;
	const id = typeof doc.header.id === 'string' ? doc.header.id : '(zone)';
	return `edit ${id}${dirty ? '*' : ''}  (${cursor.x},${cursor.y})  stamp '${glyph || '—'}'  ${health}  ·  hjkl/arrows move · space solid · . clear · g stamp · tab glyph · u undo · w write · q quit`;
}

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

// The editor's source of truth is the RAW doc (parseZone is lossy), so every edit
// mutates an `EditorDoc` and the live render is `renderZoneScene(sceneOf(parseZone(
// serializeDoc(doc))))` — keeping the last good scene on a parse error, exactly like
// `preview`. MVP scope (#84): paint terrain + place/clear glyphs ALREADY declared in
// the header; authoring new catalog refs / header keys stays a text edit.

/** A bright cursor overlay colour, resolved lazily so the module stays opentui-free. */
const CURSOR_RGBA: [number, number, number, number] = [255, 230, 90, 255];

/**
 * `zone edit <id>`: a faithful live TUI editor over the raw `.zone` doc. Move a
 * cursor, toggle solid terrain, stamp/clear declared glyphs, undo, and write back
 * to disk — re-rendering through the SAME shared renderer the game uses (#56), with
 * live validation. Long-lived: opentui owns the process lifecycle (ctrl-c / q exit).
 */
export async function runEdit(args: string[], deps: CliDeps): Promise<void> {
	const id = args[0];
	if (!id) {
		deps.log('edit: missing <id>');
		process.exitCode = 1;
		return;
	}

	const catalogs = loadCatalogs(deps.root);
	const loaded = loadZone(deps.root, id, catalogs);
	// The editor only opens a parseable file: it parses the doc on every edit for
	// live preview/validation, so an un-splittable source is not editable.
	if (!loaded.zone || loaded.text === undefined) {
		deps.log(`edit: cannot open '${id}': ${loaded.parseError ?? 'unreadable'}`);
		process.exitCode = 1;
		return;
	}
	const savedText0 = loaded.text;
	let history = initHistory(parseDoc(savedText0));
	let savedText = savedText0;
	let cursor = { x: 0, y: 0 };
	let glyphIdx = 0;
	let pendingQuit = false;

	const { createCliRenderer, Renderable, RGBA } = await import('@opentui/core');
	const style = buildSceneStyle((r, g, b, a) => RGBA.fromInts(r, g, b, a));
	const cursorColor = RGBA.fromInts(...CURSOR_RGBA);

	// Derived view of the present doc, recomputed after every edit. The scene falls
	// back to the last good one on a parse error (the doc itself is never lost).
	let scene: ZoneScene = sceneOf(loaded.zone);
	let diags: Diagnostic[] = [];
	let status = '';
	const refresh = (): void => {
		const doc = history.present;
		const glyphs = declaredGlyphs(doc);
		const glyph = glyphs[glyphIdx % Math.max(1, glyphs.length)] ?? '';
		try {
			scene = sceneOf(parseZone(serializeDoc(doc), catalogs));
		} catch {
			// keep the last good scene
		}
		diags = docDiagnostics(doc, catalogs);
		status = editStatusLine(
			doc,
			cursor,
			glyph,
			diags,
			serializeDoc(doc) !== savedText,
		);
	};
	refresh();

	class EditRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const cam: Cam = followCam(
				cursor.x,
				cursor.y,
				scene.terrain.w,
				scene.terrain.h,
				buf.width,
				buf.height,
			);
			renderZoneScene(buf, scene, cam, style);
			// Cursor: a bright overlay on the cell under it, showing its glyph.
			const sx = cursor.x - Math.round(cam.x);
			const sy = cursor.y - Math.round(cam.y);
			if (sx >= 0 && sy >= 1 && sx < buf.width && sy < buf.height) {
				const ch = cellAt(history.present, cursor.x, cursor.y);
				buf.setCell(sx, sy, ch === '.' ? '+' : ch, style.bg, cursorColor);
			}
			// Status header on row 0 (sky in most Zones), so live validation stays
			// visible without hiding terrain.
			for (let x = 0; x < buf.width; x++)
				buf.setCell(x, 0, ' ', style.paletteDefault, style.terrainBg);
			for (let i = 0; i < status.length && i < buf.width; i++)
				buf.setCell(i, 0, status[i], style.paletteDefault, style.terrainBg);
		}
	}

	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
	});
	renderer.root.add(new EditRenderable(renderer));

	// Apply a pure edit op at the cursor, push it onto the undo stack, refresh.
	const edit = (
		fn: (d: EditorDoc, x: number, y: number) => EditorDoc,
	): void => {
		history = commit(history, fn(history.present, cursor.x, cursor.y));
		refresh();
	};
	const move = (dx: number, dy: number): void => {
		cursor = clampCursor(history.present, cursor.x + dx, cursor.y + dy);
		refresh();
	};

	renderer.keyInput.on('keypress', (k: { name: string; sequence?: string }) => {
		const ch = k.sequence ?? '';
		// Any keypress other than a second `q` cancels a pending quit warning.
		if (pendingQuit && k.name !== 'q') pendingQuit = false;
		switch (k.name) {
			case 'left':
			case 'h':
				return move(-1, 0);
			case 'right':
			case 'l':
				return move(1, 0);
			case 'up':
			case 'k':
				return move(0, -1);
			case 'down':
			case 'j':
				return move(0, 1);
			case 'space':
				return edit(toggleSolid);
			case 'g': {
				const glyphs = declaredGlyphs(history.present);
				if (glyphs.length > 0)
					edit((d, x, y) =>
						placeGlyph(d, x, y, glyphs[glyphIdx % glyphs.length]),
					);
				return;
			}
			case 'tab': {
				const n = declaredGlyphs(history.present).length;
				if (n > 0) glyphIdx = (glyphIdx + 1) % n;
				return refresh();
			}
			case 'u':
				history = undo(history);
				return refresh();
			case 'w':
				savedText = serializeDoc(history.present);
				writeZone(deps.root, id, savedText);
				return refresh();
			case 'q':
				if (serializeDoc(history.present) !== savedText && !pendingQuit) {
					pendingQuit = true;
					status = `edit ${id} — unsaved changes! press q again to discard, or w to write`;
					return;
				}
				(renderer as unknown as { destroy?: () => void }).destroy?.();
				return process.exit(0);
			default:
				if (ch === '#') return edit(toggleSolid);
				if (ch === '.') return edit(clearCell);
		}
	});

	renderer.start();
}
