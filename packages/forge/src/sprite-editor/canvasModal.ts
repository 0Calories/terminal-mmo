import { allFrames, type SpriteDoc } from '@mmo/render';
import { type ResizeEdge, resizeDoc } from './resize';

export interface CanvasModal {
	readonly w0: number;
	readonly h0: number;

	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;

	readonly edge: ResizeEdge;
}

function firstFrameSize(doc: SpriteDoc): { w: number; h: number } {
	const f = allFrames(doc)[0];
	return { w: f?.rows[0]?.length ?? 1, h: f?.rows.length ?? 1 };
}

export function openCanvasModal(doc: SpriteDoc): CanvasModal {
	const { w, h } = firstFrameSize(doc);
	return { w0: w, h0: h, left: 0, right: 0, top: 0, bottom: 0, edge: 'right' };
}

export function canvasTarget(m: CanvasModal): { w: number; h: number } {
	return {
		w: Math.max(1, m.w0 + m.left + m.right),
		h: Math.max(1, m.h0 + m.top + m.bottom),
	};
}

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

export function nudgeCanvasEdge(m: CanvasModal, dir: 1 | -1): CanvasModal {
	return setEdge(m, m.edge, edgeDelta(m, m.edge) + dir);
}

export function isClipped(m: CanvasModal, x: number, y: number): boolean {
	const xMin = m.left < 0 ? -m.left : 0;
	const xMax = m.right < 0 ? m.w0 - 1 + m.right : m.w0 - 1;
	const yMin = m.top < 0 ? -m.top : 0;
	const yMax = m.bottom < 0 ? m.h0 - 1 + m.bottom : m.h0 - 1;
	return x < xMin || x > xMax || y < yMin || y > yMax;
}

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
