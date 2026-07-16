// Whole-file sizing transforms for the Sprite editor (spec #387, issue #402):
// load-normalize, save-trim, whole-file edge resize, and crop. Pure functions
// over a SpriteDoc — no editor state, no I/O — so every invariant (union bbox
// math, baseline-driven vertical growth, per-edge Anchor/baseline compensation)
// is testable in isolation.
//
// Coordinate model. A Frame is a grid of cells (`frame.rows` etc). Anchors are
// cell offsets (any integer, per ADR 0031). `doc.baseline` is measured from the
// grid BOTTOM — the render path positions a Frame by `-h + baseline`, so a Frame
// renders bottom-anchored. That fixes the compensation rules:
//   • add/remove a LEFT column   → shift every anchor x by ±1 (content slides).
//   • add/remove a RIGHT column  → no anchor shift (content unmoved).
//   • add/remove a TOP row       → shift every anchor y by ±1 (content slides).
//   • add/remove a BOTTOM row    → no anchor shift, baseline ±1 (bottom moves).
// Growing at the top therefore preserves ground contact (the bottom stays put),
// which is why load-normalize grows shorter Frames upward.
import type { SpriteAnchor, SpriteDoc, SpriteFrameDoc } from '@mmo/render';

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom';

export const RESIZE_EDGES: readonly ResizeEdge[] = [
	'left',
	'right',
	'top',
	'bottom',
];

interface Bounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function frameSize(frame: SpriteFrameDoc): { w: number; h: number } {
	return { w: frame.rows[0]?.length ?? 0, h: frame.rows.length };
}

// The tight bounding box of a Frame's inked (non-blank glyph) cells, or null when
// the Frame is fully transparent.
export function frameContentBounds(frame: SpriteFrameDoc): Bounds | null {
	let x0 = Number.POSITIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	frame.rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			if (row[x] !== ' ') {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	});
	if (x1 < x0) return null;
	return { x0, y0, x1, y1 };
}

// The union of every Frame's content bounds, or null when the whole doc is blank.
export function unionContentBounds(doc: SpriteDoc): Bounds | null {
	let out: Bounds | null = null;
	for (const f of doc.frames) {
		const b = frameContentBounds(f);
		if (!b) continue;
		out = out
			? {
					x0: Math.min(out.x0, b.x0),
					y0: Math.min(out.y0, b.y0),
					x1: Math.max(out.x1, b.x1),
					y1: Math.max(out.y1, b.y1),
				}
			: b;
	}
	return out;
}

// Whether every Frame already shares one grid size (the editor's whole-file
// policy). A single-frame doc is trivially uniform.
export function isUniform(doc: SpriteDoc): boolean {
	if (doc.frames.length === 0) return true;
	const { w, h } = frameSize(doc.frames[0]);
	return doc.frames.every((f) => {
		const s = frameSize(f);
		return s.w === w && s.h === h;
	});
}

function shiftAnchors(
	anchors: Readonly<Record<string, SpriteAnchor>>,
	dx: number,
	dy: number,
): Record<string, SpriteAnchor> {
	const out: Record<string, SpriteAnchor> = {};
	for (const [name, a] of Object.entries(anchors))
		out[name] = { x: a.x + dx, y: a.y + dy };
	return out;
}

// Shift the doc-level anchors and every Frame override by the same cell delta.
function shiftAllAnchors(doc: SpriteDoc, dx: number, dy: number): SpriteDoc {
	if (dx === 0 && dy === 0) return doc;
	return {
		...doc,
		anchors: shiftAnchors(doc.anchors, dx, dy),
		frames: doc.frames.map((f) => ({
			...f,
			anchors: shiftAnchors(f.anchors, dx, dy),
		})),
	};
}

type GridFn = (grid: readonly string[]) => string[];

function mapGrids(doc: SpriteDoc, fn: GridFn): SpriteDoc {
	return {
		...doc,
		frames: doc.frames.map((f) => ({
			...f,
			rows: fn(f.rows),
			colors: fn(f.colors),
			bg: fn(f.bg),
		})),
	};
}

// Grow or shrink the whole file by one cell on one edge, compensating anchors and
// baseline. `dir` is +1 to add (grow outward) or -1 to remove (shrink inward).
// Returns null when a shrink would collapse the grid below 1×1 (the caller reports
// it); the doc is otherwise uniform-in, uniform-out.
export function resizeDoc(
	doc: SpriteDoc,
	edge: ResizeEdge,
	dir: 1 | -1,
): SpriteDoc | null {
	if (doc.frames.length === 0) return null;
	const { w, h } = frameSize(doc.frames[0]);
	if (dir < 0) {
		if ((edge === 'left' || edge === 'right') && w <= 1) return null;
		if ((edge === 'top' || edge === 'bottom') && h <= 1) return null;
	}
	const blankRow = (width: number) => ' '.repeat(width);

	if (edge === 'left') {
		const fn: GridFn =
			dir > 0 ? (g) => g.map((r) => ` ${r}`) : (g) => g.map((r) => r.slice(1));
		return shiftAllAnchors(mapGrids(doc, fn), dir, 0);
	}
	if (edge === 'right') {
		const fn: GridFn =
			dir > 0
				? (g) => g.map((r) => `${r} `)
				: (g) => g.map((r) => r.slice(0, -1));
		return mapGrids(doc, fn);
	}
	if (edge === 'top') {
		const fn: GridFn = dir > 0 ? (g) => [blankRow(w), ...g] : (g) => g.slice(1);
		return shiftAllAnchors(mapGrids(doc, fn), 0, dir);
	}
	// bottom
	const fn: GridFn =
		dir > 0 ? (g) => [...g, blankRow(w)] : (g) => g.slice(0, -1);
	const grown = mapGrids(doc, fn);
	return { ...grown, baseline: Math.max(0, doc.baseline + dir) };
}

// Crop every Frame to an inclusive cell rectangle, compensating anchors (left/top
// removal slides them) and baseline (bottom removal lowers it). Cells outside the
// current grid are clamped in. Assumes a uniform doc (all Frames one size).
export function cropDocToCells(
	doc: SpriteDoc,
	cx0: number,
	cy0: number,
	cx1: number,
	cy1: number,
): SpriteDoc {
	if (doc.frames.length === 0) return doc;
	const { w, h } = frameSize(doc.frames[0]);
	const x0 = Math.max(0, Math.min(cx0, w - 1));
	const y0 = Math.max(0, Math.min(cy0, h - 1));
	const x1 = Math.max(x0, Math.min(cx1, w - 1));
	const y1 = Math.max(y0, Math.min(cy1, h - 1));
	const botRemoved = h - 1 - y1;
	const crop: GridFn = (g) =>
		g.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1));
	const cropped = mapGrids(doc, crop);
	const shifted = shiftAllAnchors(cropped, -x0, -y0);
	return { ...shifted, baseline: Math.max(0, doc.baseline - botRemoved) };
}

// Normalize a loaded file to the whole-file policy: every Frame grown to the union
// grid size with transparent margin, the baseline driving vertical growth (shorter
// Frames grow UPWARD so their bottom — the ground line — stays put). Horizontal
// growth pads on the right. Per-Frame Anchor overrides absorb the differing top
// pad so every Frame's effective Anchor keeps pointing at the same art. Already-
// uniform docs return unchanged (identity), so a load-normalize on a shipped
// uniform file is a no-op.
export function normalizeDoc(doc: SpriteDoc): SpriteDoc {
	if (doc.frames.length === 0 || isUniform(doc)) return doc;
	const unionW = Math.max(...doc.frames.map((f) => frameSize(f).w));
	const unionH = Math.max(...doc.frames.map((f) => frameSize(f).h));
	const frames = doc.frames.map((f) => {
		const { h } = frameSize(f);
		const topPad = unionH - h;
		const grow: GridFn = (g) => {
			const widened = g.map((r) => r.padEnd(unionW, ' '));
			const top = Array.from({ length: topPad }, () => ' '.repeat(unionW));
			return [...top, ...widened];
		};
		// Vertical growth slides this Frame's content down by `topPad`; its effective
		// Anchors (doc-level overlaid with existing overrides) must follow, but the
		// shift differs per Frame, so it is materialized as per-Frame overrides.
		let anchors = f.anchors;
		if (topPad > 0) {
			const eff: Record<string, SpriteAnchor> = {};
			for (const [name, a] of Object.entries(doc.anchors))
				eff[name] = { x: a.x, y: a.y + topPad };
			for (const [name, a] of Object.entries(f.anchors))
				eff[name] = { x: a.x, y: a.y + topPad };
			anchors = eff;
		}
		return {
			...f,
			rows: grow(f.rows),
			colors: grow(f.colors),
			bg: grow(f.bg),
			anchors,
		};
	});
	return { ...doc, frames };
}

// Trim a file to the union content bounding box across Frames, dropping workspace
// margins so they never leak into the shipped asset. A tight uniform doc trims to
// itself (identity of the serialized art), which keeps a load-normalize → save-
// trim round-trip a no-op for already-uniform files. A fully-transparent doc is
// left untouched (nothing to trim to).
export function trimDoc(doc: SpriteDoc): SpriteDoc {
	if (doc.frames.length === 0) return doc;
	const b = unionContentBounds(doc);
	if (!b) return doc;
	const { w, h } = frameSize(doc.frames[0]);
	if (b.x0 === 0 && b.y0 === 0 && b.x1 === w - 1 && b.y1 === h - 1) return doc;
	return cropDocToCells(doc, b.x0, b.y0, b.x1, b.y1);
}
