import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	cellAt,
	colorInk,
	currentFrame,
	floodFill,
	frameExtent,
	initSpriteEditor,
	paintPixel,
	readPixel,
	type SpriteEditorState,
	setInk,
	setTool,
	stampGlyph,
	TRANSPARENT_INK,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

// A 6×4-cell (12×8-Pixel) all-transparent hat frame, default ink 'p'.
function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

describe('floodFill — same-displayed-key spread, Frame-bounded', () => {
	test('a colour fill floods an empty Frame and never grows it', () => {
		const s0 = blankState();
		const before = frameExtent(currentFrame(s0));
		const s = floodFill(s0, 0, 0, colorInk('p'));
		// Every Pixel of the 12×8 canvas is now lit 'p' — corners included.
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 11, 7)).toBe(true);
		expect(cellAt(s, 0, 0).glyph).toBe('█');
		expect(cellAt(s, 5, 3).glyph).toBe('█');
		expect(cellAt(s, 5, 3).fg).toBe('p');
		// Bounded: the flood stops at the edge, it does not auto-grow the canvas.
		expect(frameExtent(currentFrame(s))).toEqual(before);
		expect(s.feedback).toContain('filled');
	});

	test('the flood stops at a different-colour region (spreads on the seed key only)', () => {
		// A solid 'g' cell in the middle splits the transparent sea around it.
		let s = setInk(blankState(), colorInk('g'));
		for (const [px, py] of [
			[4, 2],
			[5, 2],
			[4, 3],
			[5, 3],
		])
			s = paintPixel(s, px, py); // fills cell (2,1) solid 'g'
		expect(cellAt(s, 2, 1).glyph).toBe('█');
		// Flood the transparent region with 'w' from a far corner.
		s = floodFill(s, 0, 0, colorInk('w'));
		// The 'g' island is a different displayed key — untouched.
		expect(cellAt(s, 2, 1).fg).toBe('g');
		expect(cellAt(s, 2, 1).glyph).toBe('█');
		// The surrounding transparent Pixels became 'w'.
		expect(cellAt(s, 0, 0).fg).toBe('w');
		expect(cellAt(s, 5, 3).fg).toBe('w');
	});

	test('the seed key is the DISPLAYED key, not the raw stored fg', () => {
		// Build an opaque two-colour cell: fg 'g' at BR, bg 'p' filling the rest.
		let s = paintPixel(blankState(), 0, 0); // 'p' at TL
		s = setInk(s, colorInk('g'));
		s = paintPixel(s, 1, 1); // overpaint at BR → fg 'g' @ BR, bg 'p'
		expect(cellAt(s, 0, 0).fg).toBe('g'); // raw stored fg is 'g'
		expect(cellAt(s, 0, 0).bg).toBe('p');
		// Seed on BR: its DISPLAYED key is 'g' (lit), so only that Pixel matches —
		// the unlit siblings display 'p' (the bg) despite sharing the cell's fg char.
		s = floodFill(s, 1, 1, colorInk('w'));
		const cell = cellAt(s, 0, 0);
		expect(cell.fg).toBe('w'); // BR recoloured to the fill ink
		expect(cell.bg).toBe('p'); // the bg-displayed Pixels were NOT filled
		expect(cell.mask).toBe(0b1000); // still only BR is lit fg
		// The rest of the canvas stayed transparent (region was a single Pixel).
		expect(readPixel(s, 4, 4)).toBe(false);
	});

	test('a fill past the canvas edge clips with feedback, changing nothing', () => {
		const s0 = blankState();
		const s = floodFill(s0, 99, 99, colorInk('p'));
		expect(s.doc).toBe(s0.doc);
		expect(s.feedback).toContain('clipped');
	});
});

describe('floodFill — glyph stamps are walls', () => {
	test('a colour fill flows around a stamp and leaves it untouched', () => {
		let s = stampGlyph(blankState(), 2, 1, '▲'); // stamp at cell (2,1)
		s = floodFill(s, 0, 0, colorInk('w'));
		// The stamp is a wall: skipped, still its glyph, not painted.
		expect(cellAt(s, 2, 1).glyph).toBe('▲');
		expect(cellAt(s, 2, 1).mask).toBeUndefined();
		// The transparent Pixels around it filled.
		expect(cellAt(s, 0, 0).fg).toBe('w');
		expect(cellAt(s, 5, 3).fg).toBe('w');
	});

	test('a transparent fill clears the stamps bordering the region', () => {
		// Paint the whole canvas 'p', then drop a stamp into it.
		let s = floodFill(blankState(), 0, 0, colorInk('p'));
		s = stampGlyph(s, 2, 1, '▲'); // overwrites cell (2,1) with a glyph
		expect(cellAt(s, 2, 1).glyph).toBe('▲');
		// Transparent-fill the 'p' region: it clears to transparent AND the border
		// stamp is cleared with it.
		s = floodFill(s, 0, 0, TRANSPARENT_INK);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(cellAt(s, 2, 1).glyph).toBe(' '); // stamp cleared
		expect(s.feedback).toContain('cleared 1 stamp');
	});

	test('seeding a colour fill on a stamp skips it (no change)', () => {
		const s0 = stampGlyph(blankState(), 2, 1, '▲');
		const s = floodFill(s0, 4, 2, colorInk('w')); // Pixel (4,2) ∈ cell (2,1)
		expect(s.doc).toBe(s0.doc);
		expect(s.feedback).toContain('skipped');
	});

	test('seeding a transparent fill on a stamp clears just that stamp', () => {
		let s = stampGlyph(blankState(), 2, 1, '▲');
		s = stampGlyph(s, 0, 0, '●'); // a second, non-adjacent stamp
		s = floodFill(s, 4, 2, TRANSPARENT_INK); // seed on the (2,1) stamp
		expect(cellAt(s, 2, 1).glyph).toBe(' '); // this stamp cleared
		expect(cellAt(s, 0, 0).glyph).toBe('●'); // the other stamp survives (a wall)
	});
});

describe('floodFill — one undo step', () => {
	test('a multi-cell fill collapses to exactly one history entry', () => {
		const s0 = blankState();
		const depth = s0.history.past.length;
		const s = floodFill(s0, 0, 0, colorInk('p')); // fills all 48 Pixels
		expect(s.history.past.length).toBe(depth + 1);
	});

	test('one undo retreats the whole fill', () => {
		let s = floodFill(blankState(), 0, 0, colorInk('p'));
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(readPixel(s, 11, 7)).toBe(true);
		s = undoEdit(s);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 11, 7)).toBe(false);
	});

	test('a fill that changes nothing records no history and clears feedback', () => {
		const painted = floodFill(blankState(), 0, 0, colorInk('p'));
		const depth = painted.history.past.length;
		// Filling the solid 'p' canvas with 'p' again is a whole-region no-op.
		const again = floodFill(painted, 0, 0, colorInk('p'));
		expect(again.history.past.length).toBe(depth);
		expect(again.feedback).toBe('');
	});
});

describe('floodFill — the input seam routes both devices', () => {
	function fillTool(): SpriteEditorState {
		return setTool(blankState(), 'fill');
	}

	test('a left click / keyboard apply floods with the active ink', () => {
		const viaMouse = applyInput(
			setInk(fillTool(), colorInk('g')),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		const viaKey = applyInput(
			setInk(fillTool(), colorInk('g')),
			normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink' }),
		);
		expect(cellAt(viaMouse, 0, 0).fg).toBe('g');
		expect(readPixel(viaMouse, 11, 7)).toBe(true);
		// Device parity: the two events drive the pure layer to the same doc.
		expect(viaMouse.doc).toEqual(viaKey.doc);
	});

	test('a right click floods with transparent ink (clears the region)', () => {
		let s = applyInput(
			setInk(fillTool(), colorInk('p')),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		expect(readPixel(s, 0, 0)).toBe(true);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right' }),
		);
		expect(readPixel(s, 0, 0)).toBe(false);
		expect(readPixel(s, 11, 7)).toBe(false);
	});
});
