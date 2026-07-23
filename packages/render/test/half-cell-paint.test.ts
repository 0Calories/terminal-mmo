import { expect, test } from 'bun:test';
import { SCENE_COLORS } from '@mmo/core/entities';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import { compileSprite, paintSprite } from '@mmo/render/sprites';
import { parseSpriteFile, type SpriteDoc } from '../src';

const DEFAULT: RGBA = [...SCENE_COLORS.paletteDefault];

function docOf(text: string, id: string): SpriteDoc {
	const { doc, diagnostics } = parseSpriteFile(text, id);
	if (doc === null)
		throw new Error(`parse failed: ${JSON.stringify(diagnostics)}`);
	return doc;
}

// A single fully-inked cell: four opaque quadrant Pixels, no Glyph stamp.
const BLOCK = docOf(
	`{ "animations": [{ "name": "idle" }] }\n--- idle\n█\n@colors\np\n`,
	'block',
);

// A sprite whose only mark is a one-column Glyph stamp.
const STAMP = docOf(
	`{ "animations": [{ "name": "idle" }] }\n--- idle\n★\n@colors\ny\n`,
	'stamp',
);

function paintBlock(originPx: number, originPy: number): Compositor {
	const c = new Compositor(6, 6);
	paintSprite(c, compileSprite(BLOCK), {
		originPx,
		originPy,
		palette: {},
		paletteDefault: DEFAULT,
	});
	return c;
}

/** Cell coords of every non-space cell, row-major. */
function inkedCells(c: Compositor): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const surface = c.surface();
	for (let y = 0; y < surface.length; y++)
		for (let x = 0; x < surface[y].length; x++)
			if (surface[y][x].char !== ' ') out.push([x, y]);
	return out;
}

test('one Pixel of horizontal offset spreads the block across the cell boundary — a half-cell shift, not a whole cell', () => {
	// Aligned: the block owns exactly one cell.
	expect(inkedCells(paintBlock(0, 0))).toEqual([[0, 0]]);
	// One Pixel right: ink straddles two cells (right half of cell 0, left half of
	// cell 1) — the art moved half a cell, not a whole one.
	expect(inkedCells(paintBlock(1, 0))).toEqual([
		[0, 0],
		[1, 0],
	]);
	// Two Pixels right equals exactly one whole cell.
	expect(inkedCells(paintBlock(2, 0))).toEqual([[1, 0]]);
});

test('one Pixel of vertical offset spreads the block across the cell boundary — a half-cell shift on the y axis too', () => {
	expect(inkedCells(paintBlock(0, 0))).toEqual([[0, 0]]);
	expect(inkedCells(paintBlock(0, 1))).toEqual([
		[0, 0],
		[0, 1],
	]);
	expect(inkedCells(paintBlock(0, 2))).toEqual([[0, 1]]);
});

test('a half-cell straddle paints the two correct half-block quadrants', () => {
	const c = paintBlock(1, 0);
	// Right half of the origin cell, left half of the next cell.
	expect(c.cell(0, 0).char).toBe('▐');
	expect(c.cell(1, 0).char).toBe('▌');
});

test('a sprite Glyph stamp stays cell-snapped at every sub-cell Pixel origin — never split across two cells', () => {
	const compiled = compileSprite(STAMP);
	for (const originPx of [0, 1, 2, 3]) {
		const c = new Compositor(6, 6);
		paintSprite(c, compiled, {
			originPx,
			originPy: 0,
			palette: {},
			paletteDefault: DEFAULT,
		});
		const stamped = inkedCells(c).filter(([x, y]) => c.cell(x, y).char === '★');
		// Exactly one atomic cell carries the glyph, snapped to the nearest cell.
		expect(stamped).toEqual([[Math.round(originPx / 2), 0]]);
	}
});
