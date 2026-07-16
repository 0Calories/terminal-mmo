// Headless tests for whole-file sizing (issue #402): load-normalize to the union
// bounding box (baseline-driven vertical growth), whole-file edge resize with
// Anchor/baseline compensation, crop / crop-to-selection, save-trim, and the
// parser round-trip through a non-uniform (sword-modeled) fixture. Pure doc
// transforms are tested state → action → expected doc + feedback.
import { describe, expect, test } from 'bun:test';
import type { RGBAQuad } from '@mmo/core/entities';
import {
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
	beginResize,
	cancelResize,
	commitResize,
	cropToSelection,
	currentFrame,
	frameExtent,
	initSpriteEditor,
	placeAnchor,
	resizeCycleEdge,
	resizeNudge,
	type SpriteEditorState,
	saveResult,
	setSelection,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

// Build a frame from glyph rows; colors/bg default to blank (the tests below care
// about art + Anchor/baseline geometry, not the fg/bg grids).
function frame(
	name: string,
	rows: string[],
	anchors: Record<string, SpriteAnchor> = {},
): SpriteFrameDoc {
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
	frames: SpriteFrameDoc[],
	opts: {
		anchors?: Record<string, SpriteAnchor>;
		baseline?: number;
		key?: string;
	} = {},
): SpriteDoc {
	const poses: Record<string, readonly string[]> = {};
	for (const f of frames) poses[f.name] = [f.name];
	return {
		id: 'x',
		key: opts.key ?? 'p',
		baseline: opts.baseline ?? 0,
		anchors: opts.anchors ?? {},
		poses,
		fps: {},
		colors: {} as Readonly<Record<string, RGBAQuad>>,
		frames,
	};
}

const sizeOf = (f: SpriteFrameDoc) => ({
	w: f.rows[0]?.length ?? 0,
	h: f.rows.length,
});
const frameByName = (doc: SpriteDoc, name: string) =>
	doc.frames.find((f) => f.name === name);

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
	// A sword-modeled non-uniform file: a short idle Frame and a tall active Frame.
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
		// union W = 5, H = 4.
		const idle = frameByName(out, 'idle');
		expect(sizeOf(idle as SpriteFrameDoc)).toEqual({ w: 5, h: 4 });
		// Vertical growth is on TOP (ground contact preserved): the idle art keeps
		// its bottom row, a blank row is added above, and each row is right-padded.
		expect(idle?.rows).toEqual(['     ', 'AB   ', 'CD   ', 'EF   ']);
		// The tall Frame was already the union size, so it is untouched.
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
		// The doc-level anchor (used by the untouched tall Frame) is unchanged.
		expect(out.anchors.grip).toEqual({ x: 0, y: 0 });
		// active grew by 0 rows → no override.
		expect(frameByName(out, 'active')?.anchors.grip).toBeUndefined();
		// idle grew by 1 top row → an override shifts the effective grip down by 1,
		// so it still points at the same art cell.
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
		expect(out.frames[0].rows).toEqual([' AB', ' CD']);
		expect(out.anchors.grip).toEqual({ x: 2, y: 1 });
		expect(out.baseline).toBe(0);
	});

	test('adding a right column leaves Anchors and baseline put', () => {
		const out = resizeDoc(base(), 'right', 1) as SpriteDoc;
		expect(out.frames[0].rows).toEqual(['AB ', 'CD ']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });
		expect(out.baseline).toBe(0);
	});

	test('adding a top row shifts Anchor y by +1, baseline unchanged', () => {
		const out = resizeDoc(base(), 'top', 1) as SpriteDoc;
		expect(out.frames[0].rows).toEqual(['  ', 'AB', 'CD']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 2 });
		expect(out.baseline).toBe(0);
	});

	test('adding a bottom row raises the baseline, Anchors unchanged', () => {
		const out = resizeDoc(base(), 'bottom', 1) as SpriteDoc;
		expect(out.frames[0].rows).toEqual(['AB', 'CD', '  ']);
		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });
		expect(out.baseline).toBe(1);
	});

	test('removing a left column shifts Anchor x by -1', () => {
		const out = resizeDoc(base(), 'left', -1) as SpriteDoc;
		expect(out.frames[0].rows).toEqual(['B', 'D']);
		expect(out.anchors.grip).toEqual({ x: 0, y: 1 });
	});

	test('removing a bottom row lowers the baseline (clamped at 0)', () => {
		const out = resizeDoc(base(), 'bottom', -1) as SpriteDoc;
		expect(out.frames[0].rows).toEqual(['AB']);
		expect(out.baseline).toBe(0);
	});

	test('every Frame resizes together (whole-file)', () => {
		const doc = mkDoc([frame('a', ['AB', 'CD']), frame('b', ['EF', 'GH'])]);
		const out = resizeDoc(doc, 'right', 1) as SpriteDoc;
		expect(sizeOf(out.frames[0])).toEqual({ w: 3, h: 2 });
		expect(sizeOf(out.frames[1])).toEqual({ w: 3, h: 2 });
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
		expect(out.frames[0].rows).toEqual(['FG', 'JK']);
		// left removed 1 → x-1; top removed 1 → y-1.
		expect(out.anchors.grip).toEqual({ x: 1, y: 1 });
		// bottom removed 1 row (row 3) → baseline 1 - 1 = 0.
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
		// union content: x 1..2, y 1..2 → 2×2.
		expect(out.frames[0].rows).toEqual(['##', '##']);
		expect(out.frames[1].rows).toEqual(['# ', '  ']);
		expect(out.anchors.grip).toEqual({ x: 0, y: 0 });
		// bottom removed 1 row → baseline 1 - 1 = 0.
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
	// A non-uniform file: 2×3 idle, 5×4 active with a blank top row of its own.
	const NON_UNIFORM = [
		'{"key":"a","anchors":{"grip":[0,0]}}',
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
		// The frames start non-uniform.
		expect(isUniform(parsed.doc as SpriteDoc)).toBe(false);

		const state = initSpriteEditor(parsed.doc as SpriteDoc);
		// In-editor, load-normalize made every Frame one size.
		expect(isUniform(state.doc)).toBe(true);

		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const reparsed = parseSpriteFile(text, 'blade');
		expect(isUniform(reparsed.doc as SpriteDoc)).toBe(true);
		// A second load-normalize → save-trim is now a no-op (stable).
		const again = saveResult(initSpriteEditor(reparsed.doc as SpriteDoc));
		expect(again.text).toBe(text);
	});

	test('an already-uniform tight file round-trips byte-stable', () => {
		const raw = ['--- idle', '###', '###', '--- walkA', '# #', '###', ''].join(
			'\n',
		);
		// The serializer's canonical form of this uniform tight file.
		const canonical = serializeSpriteFile(
			parseSpriteFile(raw, 'walker').doc as SpriteDoc,
		);
		const parsed = parseSpriteFile(canonical, 'walker');
		const { text } = saveResult(initSpriteEditor(parsed.doc as SpriteDoc));
		expect(text).toBe(canonical);
	});
});

describe('resize mode — live nudges commit as one undo step', () => {
	function state(): SpriteEditorState {
		return initSpriteEditor(
			mkDoc([frame('idle', ['##', '##'])], {
				anchors: { grip: { x: 1, y: 1 } },
			}),
		);
	}

	test('begin selects the right edge and reports a hint', () => {
		const s = beginResize(state());
		expect(s.resize).toBe('right');
		expect(s.feedback).toContain('resize');
	});

	test('tab cycles the selected edge', () => {
		let s = beginResize(state());
		s = resizeCycleEdge(s);
		expect(s.resize).toBe('top');
	});

	test('nudges apply live without recording history', () => {
		let s = beginResize(state());
		s = resizeNudge(s, 1); // grow right
		s = resizeNudge(s, 1); // grow right again
		expect(frameExtent(currentFrame(s))).toEqual({ w: 4, h: 2 });
		// Not yet recorded: undo now would still see the pre-resize doc as present.
		expect(s.history.present).not.toBe(s.doc);
	});

	test('commit is exactly one undo step back to the original', () => {
		const start = state();
		let s = beginResize(start);
		s = resizeNudge(s, 1);
		s = resizeNudge(s, 1);
		s = commitResize(s);
		expect(s.resize).toBeNull();
		expect(frameExtent(currentFrame(s))).toEqual({ w: 4, h: 2 });
		const back = undoEdit(s);
		expect(back.doc).toBe(start.doc);
	});

	test('cancel restores the pre-resize doc losslessly', () => {
		const start = state();
		let s = beginResize(start);
		s = resizeNudge(s, -1); // shrink right → 1 wide
		s = cancelResize(s);
		expect(s.resize).toBeNull();
		expect(s.doc).toBe(start.doc);
	});

	test('cannot shrink below 1×1', () => {
		let s = beginResize(initSpriteEditor(mkDoc([frame('a', ['#'])])));
		s = resizeNudge(s, -1);
		expect(s.feedback).toContain('cannot shrink');
		expect(frameExtent(currentFrame(s))).toEqual({ w: 1, h: 1 });
	});
});

describe('cropToSelection', () => {
	function state(): SpriteEditorState {
		return initSpriteEditor(
			mkDoc([frame('idle', ['ABCD', 'EFGH', 'IJKL', 'MNOP'])], {
				anchors: { grip: { x: 0, y: 0 } },
			}),
		);
	}

	test('rounds the selection Pixel bbox outward to cells, then crops', () => {
		// Pixels x 1..4, y 1..4 → cells 0..2 × 0..2 (rounds outward).
		let s = setSelection(state(), { x0: 1, y0: 1, x1: 4, y1: 4 });
		s = cropToSelection(s);
		expect(frameExtent(currentFrame(s))).toEqual({ w: 3, h: 3 });
		expect(currentFrame(s).rows).toEqual(['ABC', 'EFG', 'IJK']);
		expect(s.selection).toBeNull();
		expect(s.feedback).toBe('cropped to 3×3');
	});

	test('is a single undo step', () => {
		const start = state();
		let s = setSelection(start, { x0: 0, y0: 0, x1: 3, y1: 3 });
		s = cropToSelection(s);
		expect(undoEdit(s).doc).toBe(start.doc);
	});

	test('refuses with feedback when there is no selection', () => {
		const s = cropToSelection(state());
		expect(s.feedback).toContain('no selection');
	});
});

describe('placeAnchor — out-of-bounds warns, never rejects', () => {
	test('an in-bounds anchor places cleanly', () => {
		const s = placeAnchor(
			initSpriteEditor(emptySpriteDoc('h', 'hat')),
			'grip',
			1,
			1,
			'doc',
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
			'doc',
		);
		expect(s.doc.anchors.grip).toEqual({ x: 99, y: 99 });
		expect(s.feedback).toContain('outside the art bounds');
	});
});
