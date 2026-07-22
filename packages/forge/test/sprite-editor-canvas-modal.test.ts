import { describe, expect, test } from 'bun:test';
import type { RGBAQuad } from '@mmo/core/entities';
import type { SpriteAnchor, SpriteDoc, SpriteFrameDoc } from '@mmo/render';
import {
	applyCanvasModal,
	canvasTarget,
	isClipped,
	nudgeCanvasEdge,
	openCanvasModal,
	setEdge,
} from '../src/sprite-editor/canvasModal';

type NamedFrame = SpriteFrameDoc & { name: string };

function frame(
	name: string,
	rows: string[],
	anchors: Record<string, SpriteAnchor> = {},
): NamedFrame {
	const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const padded = rows.map((r) => r.padEnd(w, ' '));
	const blank = padded.map((r) => ' '.repeat(r.length));
	return {
		name,
		rows: padded,
		colors: blank.slice(),
		bg: blank.slice(),
		anchors,
	};
}

function mkDoc(
	frames: NamedFrame[],
	opts: { anchors?: Record<string, SpriteAnchor>; baseline?: number } = {},
): SpriteDoc {
	return {
		id: 'x',
		key: 'p',
		baseline: opts.baseline ?? 0,
		anchors: opts.anchors ?? {},
		animations: frames.map((f) => ({ name: f.name, frames: [f] })),
		colors: {} as Readonly<Record<string, RGBAQuad>>,
	};
}

const sizeOf = (f: SpriteFrameDoc) => ({
	w: f.rows[0]?.length ?? 0,
	h: f.rows.length,
});
const frameByName = (doc: SpriteDoc, name: string) =>
	doc.animations.find((a) => a.name === name)?.frames[0];

describe('openCanvasModal / canvasTarget', () => {
	test('opens on the uniform frame size with no deltas', () => {
		const m = openCanvasModal(mkDoc([frame('idle', ['##', '##'])]));
		expect(m.w0).toBe(2);
		expect(m.h0).toBe(2);
		expect(canvasTarget(m)).toEqual({ w: 2, h: 2 });
	});
});

describe('setEdge / nudgeCanvasEdge — grow, shrink, clamp', () => {
	const base = () =>
		openCanvasModal(mkDoc([frame('idle', ['###', '###', '###'])]));

	test('growing the right edge widens; shrinking narrows', () => {
		let m = setEdge(base(), 'right', 2);
		expect(canvasTarget(m)).toEqual({ w: 5, h: 3 });
		m = setEdge(m, 'right', -1);
		expect(canvasTarget(m)).toEqual({ w: 2, h: 3 });
	});

	test('asymmetric growth: left + right add independently', () => {
		let m = setEdge(base(), 'left', 1);
		m = setEdge(m, 'right', 2);
		expect(canvasTarget(m)).toEqual({ w: 6, h: 3 });
	});

	test('an edge cannot shrink the axis below 1 cell', () => {
		const m = setEdge(base(), 'right', -10);
		expect(canvasTarget(m).w).toBe(1);
	});

	test('nudge steps the last-armed edge outward / inward', () => {
		let m = setEdge(base(), 'top', 0);
		m = nudgeCanvasEdge(m, 1);
		expect(canvasTarget(m)).toEqual({ w: 3, h: 4 });
		expect(m.edge).toBe('top');
		m = nudgeCanvasEdge(m, -1);
		expect(canvasTarget(m)).toEqual({ w: 3, h: 3 });
	});
});

describe('isClipped — pixels the current bounds would drop', () => {
	test('shrinking the right edge clips the rightmost column', () => {
		const m = setEdge(
			openCanvasModal(mkDoc([frame('idle', ['###', '###'])])),
			'right',
			-1,
		);
		expect(isClipped(m, 2, 0)).toBe(true);
		expect(isClipped(m, 1, 0)).toBe(false);
	});

	test('growing never clips', () => {
		const m = setEdge(
			openCanvasModal(mkDoc([frame('idle', ['##', '##'])])),
			'left',
			3,
		);
		expect(isClipped(m, 0, 0)).toBe(false);
		expect(isClipped(m, 1, 1)).toBe(false);
	});

	test('shrinking top clips the top row', () => {
		const m = setEdge(
			openCanvasModal(mkDoc([frame('idle', ['##', '##', '##'])])),
			'top',
			-1,
		);
		expect(isClipped(m, 0, 0)).toBe(true);
		expect(isClipped(m, 0, 1)).toBe(false);
	});
});

describe('applyCanvasModal — one transform, resize semantics preserved', () => {
	test('grows every frame together and shifts left-added anchors', () => {
		const doc = mkDoc([frame('a', ['##', '##']), frame('b', ['##', '##'])], {
			anchors: { grip: { x: 1, y: 1 } },
		});
		const m = setEdge(openCanvasModal(doc), 'left', 1);
		const out = applyCanvasModal(doc, m);
		if (!out) throw new Error('apply returned null');

		expect(sizeOf(frameByName(out, 'a') as SpriteFrameDoc)).toEqual({
			w: 3,
			h: 2,
		});
		expect(sizeOf(frameByName(out, 'b') as SpriteFrameDoc)).toEqual({
			w: 3,
			h: 2,
		});

		expect(out.anchors.grip).toEqual({ x: 2, y: 1 });
	});

	test('growing the bottom edge lowers the baseline (ground stays put)', () => {
		const doc = mkDoc([frame('a', ['##', '##'])], { baseline: 0 });
		const m = setEdge(openCanvasModal(doc), 'bottom', 2);
		const out = applyCanvasModal(doc, m);
		if (!out) throw new Error('apply returned null');
		expect(sizeOf(frameByName(out, 'a') as SpriteFrameDoc)).toEqual({
			w: 2,
			h: 4,
		});
		expect(out.baseline).toBe(2);
	});

	test('shrinking crops the removed columns', () => {
		const doc = mkDoc([frame('a', ['ABCD', 'EFGH'])]);
		const m = setEdge(openCanvasModal(doc), 'right', -2);
		const out = applyCanvasModal(doc, m);
		if (!out) throw new Error('apply returned null');
		expect((frameByName(out, 'a') as SpriteFrameDoc).rows).toEqual([
			'AB',
			'EF',
		]);
	});

	test('no-op deltas return an unchanged-size doc', () => {
		const doc = mkDoc([frame('a', ['##', '##'])]);
		const out = applyCanvasModal(doc, openCanvasModal(doc));
		if (!out) throw new Error('apply returned null');
		expect(sizeOf(frameByName(out, 'a') as SpriteFrameDoc)).toEqual({
			w: 2,
			h: 2,
		});
	});
});
