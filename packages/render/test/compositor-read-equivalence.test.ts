import { expect, test } from 'bun:test';
import {
	type CellOut,
	Compositor,
	createCellOut,
	type RGBA,
} from '../src/compositor';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const WHITE: RGBA = [255, 255, 255, 255];
const YELLOW: RGBA = [255, 255, 0, 255];
const TRANSLUCENT: RGBA = [40, 120, 200, 128];

/**
 * A scene that exercises every read branch: empty cells, a full block (one
 * opaque colour), two-colour quadrant reductions, translucent source-over,
 * plain glyph overlays over derived and authored backdrops, and a wide grapheme
 * (lead + continuation). The allocation-light read must decode all of them
 * byte-identically to `cell()`/`surface()`.
 */
function buildScene(): Compositor {
	const c = new Compositor(8, 6);

	// Full-block cells (single opaque colour).
	c.fillPixelRect(0, 0, 2, 2, RED);
	c.fillPixelRect(2, 0, 2, 2, GREEN);

	// Two-colour reductions: differing quadrants within one cell.
	c.setPixel(8, 0, RED);
	c.setPixel(9, 0, BLUE);
	c.setPixel(8, 1, WHITE);
	c.setPixel(9, 1, YELLOW);

	// Diagonal split across a cell.
	c.setPixel(10, 0, GREEN);
	c.setPixel(11, 1, BLUE);

	// Translucent source-over onto an opaque backdrop.
	c.fillPixelRect(12, 0, 2, 2, WHITE);
	c.setPixel(12, 0, TRANSLUCENT);

	// Glyph over a derived (dominant) backdrop.
	c.fillPixelRect(0, 4, 2, 2, BLUE);
	c.stampGlyph(0, 2, '@', YELLOW);

	// Glyph with an authored opaque backdrop.
	c.stampGlyph(2, 2, 'X', RED, GREEN);

	// A pixel drawn after a glyph so the glyph loses the cell to a reduction.
	c.stampGlyph(4, 2, 'K', WHITE, BLUE);
	c.setPixel(9, 5, RED);

	// Wide grapheme: lead owns both columns, continuation is blanked.
	c.stampWideGlyph(5, 3, '漢', WHITE);

	return c;
}

function sameCell(out: CellOut, cell: { char: string; fg: RGBA; bg: RGBA }) {
	expect(out.char).toBe(cell.char);
	expect([out.fg[0], out.fg[1], out.fg[2], out.fg[3]]).toEqual([...cell.fg]);
	expect([out.bg[0], out.bg[1], out.bg[2], out.bg[3]]).toEqual([...cell.bg]);
}

test('readCellInto is byte-identical to cell() for every cell of a composed scene', () => {
	const c = buildScene();
	const out = createCellOut();
	for (let y = 0; y < c.heightCells; y++) {
		for (let x = 0; x < c.widthCells; x++) {
			c.readCellInto(x, y, out);
			const cell = c.cell(x, y);
			sameCell(out, cell);
			const expectedWide = cell.wide ?? undefined;
			expect(out.wide).toBe(expectedWide);
		}
	}
});

test('one reused CellOut across the whole surface matches per-cell surface()', () => {
	const c = buildScene();
	const rows = c.surface();
	// Reuse a single out for the entire frame — the encode hot path — and prove
	// no state leaks between cells.
	const out = createCellOut();
	for (let y = 0; y < c.heightCells; y++) {
		for (let x = 0; x < c.widthCells; x++) {
			c.readCellInto(x, y, out);
			sameCell(out, rows[y][x]);
		}
	}
});

test('readCellInto never allocates a fresh out: reuse equals fresh-out reads', () => {
	const c = buildScene();
	const reused = createCellOut();
	for (let y = 0; y < c.heightCells; y++) {
		for (let x = 0; x < c.widthCells; x++) {
			c.readCellInto(x, y, reused);
			const fresh = createCellOut();
			c.readCellInto(x, y, fresh);
			sameCell(reused, fresh);
			expect(reused.wide).toBe(fresh.wide);
		}
	}
});

test('readCellInto throws out of bounds, matching cell()', () => {
	const c = new Compositor(2, 2);
	const out = createCellOut();
	expect(() => c.readCellInto(-1, 0, out)).toThrow();
	expect(() => c.readCellInto(2, 0, out)).toThrow();
	expect(() => c.readCellInto(0, 2, out)).toThrow();
});
