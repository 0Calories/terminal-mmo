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
