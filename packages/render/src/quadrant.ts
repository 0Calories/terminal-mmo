// The Sprite editor's pixel↔glyph bijection (ADR 0031): a terminal cell's art is a
// 2×2 grid of quadrant sub-pixels, each either foreground-lit or not. This module
// compiles a 4-bit quadrant bitmap to the matching Unicode block-element glyph, and
// decompiles a glyph back to its bitmap.
//
// Bit layout of the mask (0-15): bit 0 (value 1) = top-left, bit 1 (value 2) =
// top-right, bit 2 (value 4) = bottom-left, bit 3 (value 8) = bottom-right. A set
// bit means that quadrant is foreground-lit.

export const QUADRANT_GLYPHS: readonly string[] = [
	' ',
	'▘',
	'▝',
	'▀',
	'▖',
	'▌',
	'▞',
	'▛',
	'▗',
	'▚',
	'▐',
	'▜',
	'▄',
	'▙',
	'▟',
	'█',
];

export function glyphFromQuadrants(mask: number): string {
	if (!Number.isInteger(mask) || mask < 0 || mask > 15) {
		throw new RangeError(
			`quadrant mask must be an integer in [0, 15], got ${mask}`,
		);
	}
	return QUADRANT_GLYPHS[mask] as string;
}

const GLYPH_TO_MASK: ReadonlyMap<string, number> = new Map(
	QUADRANT_GLYPHS.map((glyph, mask) => [glyph, mask]),
);

export function quadrantsFromGlyph(glyph: string): number | undefined {
	return GLYPH_TO_MASK.get(glyph);
}
