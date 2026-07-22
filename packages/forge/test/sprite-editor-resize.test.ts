import { describe, expect, test } from 'bun:test';
import type { RGBAQuad } from '@mmo/core/entities';
import {
	allFrames,
	parseSpriteFile,
	type SpriteAnchor,
	type SpriteDoc,
	type SpriteFrameDoc,
	serializeSpriteFile,
} from '@mmo/render';
import {
	cropDocToCells,
	frameContentBounds,
	isUniform,
	normalizeDoc,
	resizeDoc,
	trimDoc,
	unionContentBounds,
} from '../src/sprite-editor/resize';
import {
	initSpriteEditor,
	placeAnchor,
	saveResult,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

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
	opts: {
		anchors?: Record<string, SpriteAnchor>;
		baseline?: number;
		key?: string;
	} = {},
): SpriteDoc {
	return {
		id: 'x',
		key: opts.key ?? 'p',
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

describe('content bounds', () => {
	test('frameContentBounds is the tight box of inked cells', () => {
		const f = frame('a', ['   ', ' ## ', '  # ']);
		expect(frameContentBounds(f)).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 });
	});

	test('a fully transparent frame has no bounds', () => {
		expect(frameContentBounds(frame('a', ['   ', '   ']))).toBeNull();
	});

	test('unionContentBounds spans every frame', () => {
		const doc = mkDoc([frame('a', ['#  ', '   ']), frame('b', ['   ', '  #'])]);
		expect(unionContentBounds(doc)).toEqual({ x0: 0, y0: 0, x1: 2, y1: 1 });
	});
});

describe('normalizeDoc — load-normalize to the union bbox', () => {
	function nonUniform(): SpriteDoc {
		return mkDoc(
			[
				frame('idle', ['AB', 'CD', 'EF']),
				frame('active', ['GHIJK', 'LMNOP', 'QRSTU', 'VWXYZ']),
			],
			{ anchors: { grip: { x: 0, y: 0 } }, baseline: 0 },
		);
	}

	test('already-uniform docs pass through unchanged (identity)', () => {
		const doc = mkDoc([frame('a', ['##', '##']), frame('b', ['..', '..'])]);
		expect(normalizeDoc(doc)).toBe(doc);
	});

	test('grows shorter Frames to the union size with transparent margin', () => {
		const out = normalizeDoc(nonUniform());
		expect(isUniform(out)).toBe(true);

		const idle = frameByName(out, 'idle');
		expect(sizeOf(idle as SpriteFrameDoc)).toEqual({ w: 5, h: 4 });

		expect(idle?.rows).toEqual(['     ', 'AB   ', 'CD   ', 'EF   ']);

		expect(frameByName(out, 'active')?.rows).toEqual([
			'GHIJK',
			'LMNOP',
			'QRSTU',
			'VWXYZ',
		]);
	});

	test('baseline is unchanged (top growth keeps the bottom-referenced baseline)', () => {
		expect(normalizeDoc(nonUniform()).baseline).toBe(0);
	});

	test('Anchors follow the per-Frame vertical shift via overrides', () => {
		const out = normalizeDoc(nonUniform());

		expect(out.anchors.grip).toEqual({ x: 0, y: 0 });

		expect(frameByName(out, 'active')?.anchors.grip).toBeUndefined();

		expect(frameByName(out, 'idle')?.anchors.grip).toEqual({ x: 0, y: 1 });
	});
});

describe('resizeDoc — whole-file edge add/remove with compensation', () => {
	function base(): SpriteDoc {
		return mkDoc([frame('a', ['AB', 'CD'])], {
			anchors: { grip: { x: 1, y: 1 } },
			baseline: 0,
		});
	}

	test('adding a left column shifts every Anchor x by +1 cell (2 Pixels)', () => {
		const out = resizeDoc(base(), 'left', 1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual([' AB', ' CD']);
		expect(out.anchors.grip).toEqual({ x: 2, y: 1 });
		expect(out.baseline).toBe(0);
	});

	test('adding a right column leaves Anchors and baseline put', () => {
		const out = resizeDoc(base(), 'right', 1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual(['AB ', 'CD ']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });
		expect(out.baseline).toBe(0);
	});

	test('adding a top row shifts Anchor y by +1, baseline unchanged', () => {
		const out = resizeDoc(base(), 'top', 1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual(['  ', 'AB', 'CD']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 2 });
		expect(out.baseline).toBe(0);
	});

	test('adding a bottom row raises the baseline, Anchors unchanged', () => {
		const out = resizeDoc(base(), 'bottom', 1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual(['AB', 'CD', '  ']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });
		expect(out.baseline).toBe(1);
	});

	test('removing a left column shifts Anchor x by -1', () => {
		const out = resizeDoc(base(), 'left', -1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual(['B', 'D']);
		expect(out.anchors.grip).toEqual({ x: 0, y: 1 });
	});

	test('removing a bottom row lowers the baseline (clamped at 0)', () => {
		const out = resizeDoc(base(), 'bottom', -1) as SpriteDoc;
		expect(allFrames(out)[0].rows).toEqual(['AB']);
		expect(out.baseline).toBe(0);
	});

	test('every Frame resizes together (whole-file)', () => {
		const doc = mkDoc([frame('a', ['AB', 'CD']), frame('b', ['EF', 'GH'])]);
		const out = resizeDoc(doc, 'right', 1) as SpriteDoc;
		expect(sizeOf(allFrames(out)[0])).toEqual({ w: 3, h: 2 });
		expect(sizeOf(allFrames(out)[1])).toEqual({ w: 3, h: 2 });
	});

	test('refuses (null) a shrink that would collapse below 1×1', () => {
		let doc = mkDoc([frame('a', ['A'])]);
		expect(resizeDoc(doc, 'left', -1)).toBeNull();
		expect(resizeDoc(doc, 'top', -1)).toBeNull();
		doc = mkDoc([frame('a', ['AB'])]);
		expect(resizeDoc(doc, 'left', -1)).not.toBeNull();
	});
});

describe('cropDocToCells — crop with compensation', () => {
	test('slides Anchors for left/top removal and lowers baseline for bottom', () => {
		const doc = mkDoc([frame('a', ['ABCD', 'EFGH', 'IJKL', 'MNOP'])], {
			anchors: { grip: { x: 2, y: 2 } },
			baseline: 1,
		});
		const out = cropDocToCells(doc, 1, 1, 2, 2);
		expect(allFrames(out)[0].rows).toEqual(['FG', 'JK']);

		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });

		expect(out.baseline).toBe(0);
	});
});

describe('trimDoc — save trims to the union content bbox', () => {
	test('drops workspace margin across Frames, compensating geometry', () => {
		const doc = mkDoc(
			[
				frame('a', ['    ', ' ## ', ' ## ', '    ']),
				frame('b', ['    ', ' #  ', '    ', '    ']),
			],
			{ anchors: { grip: { x: 1, y: 1 } }, baseline: 1 },
		);
		const out = trimDoc(doc);

		expect(allFrames(out)[0].rows).toEqual(['##', '##']);
		expect(allFrames(out)[1].rows).toEqual(['# ', '  ']);
		expect(out.anchors.grip).toEqual({ x: 0, y: 0 });

		expect(out.baseline).toBe(0);
	});

	test('a tight uniform doc trims to itself (identity)', () => {
		const doc = mkDoc([frame('a', ['##', '##'])]);
		expect(trimDoc(doc)).toBe(doc);
	});

	test('a fully-transparent doc is left untouched', () => {
		const doc = mkDoc([frame('a', ['  ', '  '])]);
		expect(trimDoc(doc)).toBe(doc);
	});
});

describe('parser round-trip through the editor', () => {
	const NON_UNIFORM = [
		'{"key":"a","anchors":{"grip":[0,0]},"animations":[{"name":"idle"},{"name":"active"}]}',
		'--- idle',
		'##',
		'##',
		'##',
		'--- active',
		'·····',
		'#####',
		'#####',
		'#####',
		'',
	].join('\n');

	test('load-normalize → save-trim uniformizes a non-uniform file', () => {
		const parsed = parseSpriteFile(NON_UNIFORM, 'blade');
		expect(parsed.doc).not.toBeNull();

		expect(isUniform(parsed.doc as SpriteDoc)).toBe(false);

		const state = initSpriteEditor(parsed.doc as SpriteDoc);

		expect(isUniform(state.doc)).toBe(true);

		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const reparsed = parseSpriteFile(text, 'blade');
		expect(isUniform(reparsed.doc as SpriteDoc)).toBe(true);

		const again = saveResult(initSpriteEditor(reparsed.doc as SpriteDoc));
		expect(again.text).toBe(text);
	});

	test('an already-uniform tight file round-trips byte-stable', () => {
		const raw = [
			'{"animations":[{"name":"idle"},{"name":"walkA"}]}',
			'--- idle',
			'###',
			'###',
			'--- walkA',
			'# #',
			'###',
			'',
		].join('\n');

		const canonical = serializeSpriteFile(
			parseSpriteFile(raw, 'walker').doc as SpriteDoc,
		);
		const parsed = parseSpriteFile(canonical, 'walker');
		const { text } = saveResult(initSpriteEditor(parsed.doc as SpriteDoc));
		expect(text).toBe(canonical);
	});
});

describe('placeAnchor — out-of-bounds warns, never rejects', () => {
	test('an in-bounds anchor places cleanly', () => {
		const s = placeAnchor(
			initSpriteEditor(emptySpriteDoc('h', 'hat')),
			'grip',
			1,
			1,
		);
		expect(s.feedback).toBe('');
		expect(s.doc.anchors.grip).toEqual({ x: 1, y: 1 });
	});

	test('an out-of-bounds anchor is still placed, with a status warning', () => {
		const s = placeAnchor(
			initSpriteEditor(emptySpriteDoc('h', 'hat')),
			'grip',
			99,
			99,
		);
		expect(s.doc.anchors.grip).toEqual({ x: 99, y: 99 });
		expect(s.feedback).toContain('outside the art bounds');
	});
});
