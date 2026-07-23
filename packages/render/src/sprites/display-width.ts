const WIDE_RANGES: readonly (readonly [number, number])[] = [
	[0x1100, 0x115f],
	[0x2329, 0x232a],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe10, 0xfe19],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x1f300, 0x1faff],
	[0x20000, 0x3fffd],
];

function inRanges(cp: number): boolean {
	for (const [lo, hi] of WIDE_RANGES) {
		if (cp >= lo && cp <= hi) return true;
	}
	return false;
}

function isZeroWidth(cp: number): boolean {
	return (
		cp === 0x200b ||
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x20d0 && cp <= 0x20ff)
	);
}

/**
 * Terminal column count for a Sprite Glyph stamp. Enough to reject wide (CJK,
 * fullwidth, emoji) and zero-width characters; the common stamps are ordinary
 * single-column glyphs that return 1.
 */
export function displayColumns(grapheme: string): number {
	let width = 0;
	for (const ch of grapheme) {
		const cp = ch.codePointAt(0);
		if (cp === undefined) continue;
		if (cp === 0xfe0f) {
			width = 2; // emoji presentation selector forces a wide cluster
			continue;
		}
		if (isZeroWidth(cp)) continue;
		width += inRanges(cp) ? 2 : 1;
	}
	return width;
}
