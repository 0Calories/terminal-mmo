import {
	allFrames,
	mapDocFrames,
	type SpriteAnchor,
	type SpriteDoc,
	type SpriteFrameDoc,
} from '@mmo/render';

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

export function unionContentBounds(doc: SpriteDoc): Bounds | null {
	let out: Bounds | null = null;
	for (const f of allFrames(doc)) {
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

export function isUniform(doc: SpriteDoc): boolean {
	const frames = allFrames(doc);
	if (frames.length === 0) return true;
	const { w, h } = frameSize(frames[0]);
	return frames.every((f) => {
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

function shiftAllAnchors(doc: SpriteDoc, dx: number, dy: number): SpriteDoc {
	if (dx === 0 && dy === 0) return doc;
	return {
		...mapDocFrames(doc, (f) => ({
			...f,
			anchors: shiftAnchors(f.anchors, dx, dy),
		})),
		anchors: shiftAnchors(doc.anchors, dx, dy),
	};
}

type GridFn = (grid: readonly string[]) => string[];

function mapGrids(doc: SpriteDoc, fn: GridFn): SpriteDoc {
	return mapDocFrames(doc, (f) => ({
		...f,
		rows: fn(f.rows),
		colors: fn(f.colors),
		bg: fn(f.bg),
	}));
}

export function resizeDoc(
	doc: SpriteDoc,
	edge: ResizeEdge,
	dir: 1 | -1,
): SpriteDoc | null {
	const first = allFrames(doc)[0];
	if (first === undefined) return null;
	const { w, h } = frameSize(first);
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

	const fn: GridFn =
		dir > 0 ? (g) => [...g, blankRow(w)] : (g) => g.slice(0, -1);
	const grown = mapGrids(doc, fn);
	return { ...grown, baseline: Math.max(0, doc.baseline + dir) };
}

export function cropDocToCells(
	doc: SpriteDoc,
	cx0: number,
	cy0: number,
	cx1: number,
	cy1: number,
): SpriteDoc {
	const first = allFrames(doc)[0];
	if (first === undefined) return doc;
	const { w, h } = frameSize(first);
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

export function normalizeDoc(doc: SpriteDoc): SpriteDoc {
	const frames = allFrames(doc);
	if (frames.length === 0 || isUniform(doc)) return doc;
	const unionW = Math.max(...frames.map((f) => frameSize(f).w));
	const unionH = Math.max(...frames.map((f) => frameSize(f).h));
	return mapDocFrames(doc, (f) => {
		const { h } = frameSize(f);
		const topPad = unionH - h;
		const grow: GridFn = (g) => {
			const widened = g.map((r) => r.padEnd(unionW, ' '));
			const top = Array.from({ length: topPad }, () => ' '.repeat(unionW));
			return [...top, ...widened];
		};

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
}

export function trimDoc(doc: SpriteDoc): SpriteDoc {
	const first = allFrames(doc)[0];
	if (first === undefined) return doc;
	const b = unionContentBounds(doc);
	if (!b) return doc;
	const { w, h } = frameSize(first);
	if (b.x0 === 0 && b.y0 === 0 && b.x1 === w - 1 && b.y1 === h - 1) return doc;
	return cropDocToCells(doc, b.x0, b.y0, b.x1, b.y1);
}
