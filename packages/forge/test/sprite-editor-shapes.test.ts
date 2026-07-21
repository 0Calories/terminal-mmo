import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	beginShape,
	cancelShape,
	colorInk,
	commitShape,
	constrainSquare,
	currentFrame,
	ellipsePixels,
	frameExtent,
	initSpriteEditor,
	linePixels,
	type Point,
	pencilLineTo,
	readPixel,
	rectPixels,
	type SpriteEditorState,
	setInk,
	setTool,
	shapePreviewPixels,
	TRANSPARENT_INK,
	toggleShapeMode,
	undoEdit,
	updateShape,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

// The hat template is a 6×4 cell canvas → 12×8 Pixels.
function blankState(): SpriteEditorState {
	// Start on the pencil: the editor's launch default is now the select tool, but
	// these tests drive shape gestures explicitly and the plain left-click paths
	// here expect painting, not a marquee.
	return setTool(initSpriteEditor(emptySpriteDoc('test', 'hat')), 'paint');
}

const key = (pts: readonly Point[]): string =>
	[...pts]
		.map((p) => `${p.x},${p.y}`)
		.sort()
		.join(' ');

// ---------------------------------------------------------------------------
// Rasterization — pure geometry over Pixels
// ---------------------------------------------------------------------------

describe('linePixels', () => {
	test('a horizontal run is contiguous', () => {
		expect(linePixels({ x: 0, y: 1 }, { x: 3, y: 1 })).toEqual([
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 3, y: 1 },
		]);
	});

	test('a vertical run is contiguous', () => {
		expect(linePixels({ x: 2, y: 0 }, { x: 2, y: 2 })).toEqual([
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 2, y: 2 },
		]);
	});

	test('a 45° diagonal steps one Pixel per axis', () => {
		expect(linePixels({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 2, y: 2 },
			{ x: 3, y: 3 },
		]);
	});

	test('a zero-length line is a single Pixel', () => {
		expect(linePixels({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([
			{ x: 4, y: 4 },
		]);
	});

	test('a line spans its two endpoints with one Pixel per major-axis step', () => {
		const a = linePixels({ x: 0, y: 0 }, { x: 4, y: 2 });
		expect(a).toHaveLength(5); // dx=4 dominates → 5 Pixels
		expect(a[0]).toEqual({ x: 0, y: 0 });
		expect(a.at(-1)).toEqual({ x: 4, y: 2 });
	});
});

describe('rectPixels', () => {
	test('outline is the four edges of the bbox, hollow centre', () => {
		const out = rectPixels({ x: 0, y: 0 }, { x: 2, y: 2 }, false);
		expect(out).toHaveLength(8);
		expect(key(out)).not.toContain('1,1'); // centre excluded
		expect(out).toContainEqual({ x: 0, y: 0 });
		expect(out).toContainEqual({ x: 2, y: 2 });
	});

	test('filled covers every enclosed Pixel', () => {
		const out = rectPixels({ x: 0, y: 0 }, { x: 2, y: 2 }, true);
		expect(out).toHaveLength(9);
		expect(out).toContainEqual({ x: 1, y: 1 });
	});

	test('the bbox is corner-to-corner regardless of drag direction', () => {
		const a = rectPixels({ x: 3, y: 2 }, { x: 0, y: 0 }, true);
		const b = rectPixels({ x: 0, y: 0 }, { x: 3, y: 2 }, true);
		expect(key(a)).toBe(key(b));
	});
});

describe('ellipsePixels', () => {
	test('filled excludes the bbox corners but includes the centre', () => {
		const out = ellipsePixels({ x: 0, y: 0 }, { x: 4, y: 4 }, true);
		expect(out).toContainEqual({ x: 2, y: 2 });
		for (const corner of [
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 0, y: 4 },
			{ x: 4, y: 4 },
		])
			expect(out).not.toContainEqual(corner);
	});

	test('outline is a subset of filled and hollow at the centre', () => {
		const outline = ellipsePixels({ x: 0, y: 0 }, { x: 4, y: 4 }, false);
		const filled = ellipsePixels({ x: 0, y: 0 }, { x: 4, y: 4 }, true);
		const filledKeys = new Set(filled.map((p) => `${p.x},${p.y}`));
		for (const p of outline) expect(filledKeys.has(`${p.x},${p.y}`)).toBe(true);
		expect(outline).not.toContainEqual({ x: 2, y: 2 }); // ring is hollow
		expect(filled).toContainEqual({ x: 2, y: 2 });
	});

	test('a collapsed axis degrades to the straight segment', () => {
		expect(key(ellipsePixels({ x: 0, y: 0 }, { x: 3, y: 0 }, false))).toBe(
			key([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 2, y: 0 },
				{ x: 3, y: 0 },
			]),
		);
	});
});

describe('constrainSquare — visual square on the 1:2 Pixel aspect', () => {
	test('width is twice the height, the larger visual side governing', () => {
		// dx=10, dy=2 → the horizontal side dominates visually (10 vs 2×2=4).
		expect(constrainSquare({ x: 0, y: 0 }, { x: 10, y: 2 })).toEqual({
			x: 10,
			y: 5,
		});
	});

	test('a dominant vertical side grows the width to 2×height', () => {
		expect(constrainSquare({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({
			x: 8,
			y: 4,
		});
	});

	test('the sign of each axis is preserved', () => {
		expect(constrainSquare({ x: 0, y: 0 }, { x: -4, y: 3 })).toEqual({
			x: -6,
			y: 3,
		});
	});

	test('a zero drag stays put', () => {
		expect(constrainSquare({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
			x: 5,
			y: 5,
		});
	});
});

// ---------------------------------------------------------------------------
// Pending-shape lifecycle — the one shared anchor state
// ---------------------------------------------------------------------------

describe('shape lifecycle', () => {
	test('beginShape drops an anchor and collapses the preview onto it', () => {
		const s = beginShape(blankState(), 'line', 1, 1, colorInk('g'));
		expect(s.shape).toEqual({
			tool: 'line',
			anchor: { x: 1, y: 1 },
			to: { x: 1, y: 1 },
			constrain: false,
			ink: colorInk('g'),
		});
		expect(shapePreviewPixels(s)).toEqual([{ x: 1, y: 1 }]);
	});

	test('updateShape drags the endpoint and grows the preview', () => {
		let s = beginShape(blankState(), 'line', 0, 0, colorInk('g'));
		s = updateShape(s, 3, 0);
		expect(shapePreviewPixels(s)).toHaveLength(4);
		expect(s.cursor).toEqual({ x: 3, y: 0 });
	});

	test('commitShape paints the shape and clears the pending state', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = beginShape(s, 'line', 0, 0, colorInk('g'));
		s = updateShape(s, 3, 0);
		const before = s.history.past.length;
		s = commitShape(s);
		expect(s.shape).toBeNull();
		for (let x = 0; x <= 3; x++) expect(readPixel(s, x, 0)).toBe(true);
		// Exactly one undo step for the whole shape.
		expect(s.history.past.length).toBe(before + 1);
		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 3, 0)).toBe(false);
	});

	test('a filled rect commit lights every enclosed Pixel', () => {
		let s = setTool(blankState(), 'rect');
		s = { ...s, rectMode: 'filled' };
		s = beginShape(s, 'rect', 0, 0, colorInk('g'));
		s = updateShape(s, 2, 2);
		s = commitShape(s);
		for (let y = 0; y <= 2; y++)
			for (let x = 0; x <= 2; x++) expect(readPixel(s, x, y)).toBe(true);
	});

	test('out-of-bounds Pixels clip with feedback and never grow the canvas', () => {
		let s = beginShape(blankState(), 'rect', 0, 0, colorInk('g'));
		s = { ...s, rectMode: 'filled' };
		const ext0 = frameExtent(currentFrame(s));
		s = updateShape(s, 20, 20); // far past the 12×8 Pixel bounds
		s = commitShape(s);
		expect(s.feedback).toContain('clipped');
		// The canvas kept its size — no auto-grow (spec #394).
		expect(frameExtent(currentFrame(s))).toEqual(ext0);
	});

	test('cancelShape abandons the shape losslessly', () => {
		const s0 = blankState();
		let s = beginShape(s0, 'line', 0, 0, colorInk('g'));
		s = updateShape(s, 4, 0);
		s = cancelShape(s);
		expect(s.shape).toBeNull();
		expect(s.doc).toBe(s0.doc); // nothing painted
	});
});

describe('toggleShapeMode', () => {
	test('flips the active tool between outline and filled', () => {
		let s = setTool(blankState(), 'rect');
		expect(s.rectMode).toBe('outline');
		s = toggleShapeMode(s);
		expect(s.rectMode).toBe('filled');
		s = toggleShapeMode(s);
		expect(s.rectMode).toBe('outline');
	});

	test('is per-tool — rect and ellipse carry independent modes', () => {
		let s = setTool(blankState(), 'ellipse');
		s = toggleShapeMode(s);
		expect(s.ellipseMode).toBe('filled');
		expect(s.rectMode).toBe('outline'); // untouched
	});

	test('the line tool has no fill mode', () => {
		const s = toggleShapeMode(setTool(blankState(), 'line'));
		expect(s.feedback).toContain('no fill mode');
	});
});

// ---------------------------------------------------------------------------
// Pencil shift-line
// ---------------------------------------------------------------------------

describe('pencilLineTo', () => {
	test('with no prior point it paints just the endpoint', () => {
		const s = pencilLineTo(blankState(), 2, 0, colorInk('g'));
		expect(readPixel(s, 2, 0)).toBe(true);
		expect(readPixel(s, 1, 0)).toBe(false);
		expect(s.lastPaint).toEqual({ x: 2, y: 0 });
	});

	test('strokes a line from the last point as one undo step', () => {
		let s: SpriteEditorState = { ...blankState(), lastPaint: { x: 0, y: 0 } };
		const before = s.history.past.length;
		s = pencilLineTo(s, 3, 0, colorInk('g'));
		for (let x = 0; x <= 3; x++) expect(readPixel(s, x, 0)).toBe(true);
		expect(s.history.past.length).toBe(before + 1);
		s = undoEdit(s);
		for (let x = 0; x <= 3; x++) expect(readPixel(s, x, 0)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Gesture grammar through the normalized input seam (device parity)
// ---------------------------------------------------------------------------

describe('shape gestures — drag-commit vs click-click parity', () => {
	// A mouse gesture: press, drag, release.
	function viaMouse(tool: 'line' | 'rect' | 'ellipse'): SpriteEditorState {
		let s = setTool(setInk(blankState(), colorInk('g')), tool);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 0 }, button: 'left', phase: 'drag' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 0 }, button: 'left', phase: 'up' }),
		);
		return s;
	}

	// A keyboard gesture: enter (anchor), move, enter (commit).
	function viaKey(tool: 'line' | 'rect' | 'ellipse'): SpriteEditorState {
		let s = setTool(setInk(blankState(), colorInk('g')), tool);
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink', phase: 'toggle' }),
		);
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 3, y: 0 }, paint: 'none', phase: 'move' }),
		);
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 3, y: 0 }, paint: 'ink', phase: 'toggle' }),
		);
		return s;
	}

	test('a mouse drag commits a line', () => {
		const s = viaMouse('line');
		expect(s.shape).toBeNull();
		for (let x = 0; x <= 3; x++) expect(readPixel(s, x, 0)).toBe(true);
	});

	test('both devices drive the same shared state to the same committed art', () => {
		for (const tool of ['line', 'rect', 'ellipse'] as const)
			expect(viaMouse(tool).doc).toEqual(viaKey(tool).doc);
	});

	test('the shape is pending (live preview) before the release commits', () => {
		let s = setTool(setInk(blankState(), colorInk('g')), 'rect');
		const doc0 = s.doc;
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 3, y: 2 }, button: 'left', phase: 'drag' }),
		);
		expect(s.shape).not.toBeNull();
		expect(shapePreviewPixels(s).length).toBeGreaterThan(0);
		expect(s.doc).toBe(doc0); // nothing committed yet
	});

	test('esc cancels a pending keyboard shape without painting', () => {
		let s = setTool(setInk(blankState(), colorInk('g')), 'line');
		const doc0 = s.doc;
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink', phase: 'toggle' }),
		);
		s = applyInput(
			s,
			normalizeKey({ pixel: { x: 3, y: 0 }, paint: 'none', phase: 'cancel' }),
		);
		expect(s.shape).toBeNull();
		expect(s.doc).toBe(doc0);
	});
});

describe('shift-constrained shapes', () => {
	test('a shift-drag rect commits a visually square bbox (w = 2×h)', () => {
		let s = setTool(setInk(blankState(), colorInk('g')), 'rect');
		s = { ...s, rectMode: 'filled' };
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		// Drag to (6,1) with shift: h from max(1, round(6/2)=3) = 3 → (6,3).
		s = applyInput(
			s,
			normalizeMouse({
				pixel: { x: 6, y: 1 },
				button: 'left',
				phase: 'drag',
				shift: true,
			}),
		);
		s = applyInput(
			s,
			normalizeMouse({
				pixel: { x: 6, y: 1 },
				button: 'left',
				phase: 'up',
				shift: true,
			}),
		);
		// The filled square spans x∈[0,6], y∈[0,3].
		expect(readPixel(s, 6, 3)).toBe(true);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 6, 4)).toBe(false); // nothing below the square
	});
});

describe('right-button shapes paint transparent ink', () => {
	test('a right-drag begins a shape whose ink is transparent', () => {
		let s = setTool(setInk(blankState(), colorInk('g')), 'rect');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right', phase: 'down' }),
		);
		expect(s.shape?.ink).toEqual(TRANSPARENT_INK);
	});

	test('committing a transparent rect punches painted Pixels out', () => {
		// Fill a small block with colour, then erase its outline with a right-drag.
		let s = setInk(blankState(), colorInk('g'));
		for (let y = 0; y <= 2; y++)
			for (let x = 0; x <= 2; x++) {
				s = applyInput(s, normalizeMouse({ pixel: { x, y }, button: 'left' }));
			}
		s = setTool(s, 'rect'); // outline mode
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right', phase: 'down' }),
		);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 2, y: 2 }, button: 'right', phase: 'up' }),
		);
		expect(readPixel(s, 0, 0)).toBe(false); // corner erased
		expect(readPixel(s, 1, 1)).toBe(true); // interior untouched by the outline
	});
});
