// The canvas-size modal's pure model (round 3). One control replaces the old
// whole-file resize mode AND crop: the user drags any edge or corner of a bright
// canvas-bounds rectangle to grow or shrink that side, so crop, enlarge and shift
// are one gesture (asymmetric growth = a content offset). The model tracks the
// per-edge growth in CELLS, computes the live target size, marks which original
// cells the current bounds would clip, and applies the whole thing as a single
// doc transform — composed from the same per-edge `resizeDoc` steps the old
// resize used, so Anchor/baseline compensation is preserved byte-for-byte.
//
// Everything here is pure geometry over a SpriteDoc; `tui.ts` renders the box,
// hit-tests the edge/corner drags, and commits `applyCanvasModal` on enter.
import { allFrames, type SpriteDoc } from '@mmo/render';
import { type ResizeEdge, resizeDoc } from './resize';

export interface CanvasModal {
	// The original (pre-edit) canvas size in CELLS — every Frame shares it (the
	// editor keeps the doc uniform).
	readonly w0: number;
	readonly h0: number;
	// Per-edge growth in cells: + grows that side outward (adds cells), - shrinks
	// it inward (removes cells). The four are independent, so asymmetric values
	// offset the content.
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
	// The last edge grabbed (mouse) or armed (arrow keys), so a bare arrow nudge
	// knows which side to move.
	readonly edge: ResizeEdge;
}

function firstFrameSize(doc: SpriteDoc): { w: number; h: number } {
	const f = allFrames(doc)[0];
	return { w: f?.rows[0]?.length ?? 1, h: f?.rows.length ?? 1 };
}

// Open the modal on the doc's uniform Frame size, no deltas yet, the right edge
// armed (matching the old resize mode's initial edge).
export function openCanvasModal(doc: SpriteDoc): CanvasModal {
	const { w, h } = firstFrameSize(doc);
	return { w0: w, h0: h, left: 0, right: 0, top: 0, bottom: 0, edge: 'right' };
}

// The live target size, each axis clamped to at least one cell.
export function canvasTarget(m: CanvasModal): { w: number; h: number } {
	return {
		w: Math.max(1, m.w0 + m.left + m.right),
		h: Math.max(1, m.h0 + m.top + m.bottom),
	};
}

// The smallest delta an edge may hold before its axis would collapse below one
// cell, given the OTHER edge on that axis.
function minDelta(m: CanvasModal, edge: ResizeEdge): number {
	switch (edge) {
		case 'left':
			return 1 - m.w0 - m.right;
		case 'right':
			return 1 - m.w0 - m.left;
		case 'top':
			return 1 - m.h0 - m.bottom;
		default:
			return 1 - m.h0 - m.top;
	}
}

// Set one edge's absolute growth (mouse-drag), clamped so the axis stays ≥ 1
// cell, and arm that edge for subsequent arrow nudges.
export function setEdge(
	m: CanvasModal,
	edge: ResizeEdge,
	delta: number,
): CanvasModal {
	const d = Math.max(delta, minDelta(m, edge));
	const base: CanvasModal = { ...m, edge };
	switch (edge) {
		case 'left':
			return { ...base, left: d };
		case 'right':
			return { ...base, right: d };
		case 'top':
			return { ...base, top: d };
		default:
			return { ...base, bottom: d };
	}
}

// The current growth of one edge.
function edgeDelta(m: CanvasModal, edge: ResizeEdge): number {
	switch (edge) {
		case 'left':
			return m.left;
		case 'right':
			return m.right;
		case 'top':
			return m.top;
		default:
			return m.bottom;
	}
}

// Nudge the last-armed edge outward (+1) or inward (-1), clamped. Arrow keys.
export function nudgeCanvasEdge(m: CanvasModal, dir: 1 | -1): CanvasModal {
	return setEdge(m, m.edge, edgeDelta(m, m.edge) + dir);
}

// Whether an original-grid cell (x, y) would be clipped by the current target
// bounds — i.e. it falls in a column/row a shrink removes. Growing never clips.
export function isClipped(m: CanvasModal, x: number, y: number): boolean {
	const xMin = m.left < 0 ? -m.left : 0;
	const xMax = m.right < 0 ? m.w0 - 1 + m.right : m.w0 - 1;
	const yMin = m.top < 0 ? -m.top : 0;
	const yMax = m.bottom < 0 ? m.h0 - 1 + m.bottom : m.h0 - 1;
	return x < xMin || x > xMax || y < yMin || y > yMax;
}

// Apply the modal as ONE doc transform: compose the per-edge `resizeDoc` steps
// (grow adds, shrink removes), which carries the old resize's exact Anchor/
// baseline compensation. Returns null only if the composition would collapse a
// Frame below 1×1 (the caller clamps well before this, so it should not happen).
export function applyCanvasModal(
	doc: SpriteDoc,
	m: CanvasModal,
): SpriteDoc | null {
	const steps: readonly [ResizeEdge, number][] = [
		['left', m.left],
		['right', m.right],
		['top', m.top],
		['bottom', m.bottom],
	];
	let d: SpriteDoc | null = doc;
	for (const [edge, delta] of steps) {
		const dir: 1 | -1 = delta >= 0 ? 1 : -1;
		for (let i = 0; i < Math.abs(delta); i++) {
			if (!d) return null;
			d = resizeDoc(d, edge, dir);
		}
	}
	return d;
}
