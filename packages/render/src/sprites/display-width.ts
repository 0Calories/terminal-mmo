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

const ZWJ = 0x200d;
const VS16 = 0xfe0f;

let segmenter: Intl.Segmenter | undefined;
let segmenterResolved = false;

function graphemeSegmenter(): Intl.Segmenter | undefined {
	if (segmenterResolved) return segmenter;
	segmenterResolved = true;
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	}
	return segmenter;
}

/**
 * Minimal fallback cluster splitter for runtimes without `Intl.Segmenter`. It
 * keeps combining marks, ZWJ joins, and the VS-16 emoji selector attached to
 * their base so a cluster stays one atomic overlay.
 */
function fallbackSegment(text: string): string[] {
	const out: string[] = [];
	let cur = '';
	let joinNext = false;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		const attaches = joinNext || isZeroWidth(cp) || cp === VS16 || cp === ZWJ;
		if (cur === '') cur = ch;
		else if (attaches) cur += ch;
		else {
			out.push(cur);
			cur = ch;
		}
		joinNext = cp === ZWJ;
	}
	if (cur) out.push(cur);
	return out;
}

/**
 * Split text into grapheme clusters. A combining sequence (base + marks) and a
 * ZWJ/VS-16 emoji sequence each stay one cluster, so dynamic world text iterates
 * user-perceived characters instead of UTF-16 code units.
 */
export function segmentGraphemes(text: string): string[] {
	const seg = graphemeSegmenter();
	if (seg) return Array.from(seg.segment(text), (s) => s.segment);
	return fallbackSegment(text);
}

/** Total terminal columns text occupies, summed over its grapheme clusters. */
export function textColumns(text: string): number {
	let cols = 0;
	for (const g of segmentGraphemes(text)) cols += displayColumns(g);
	return cols;
}
