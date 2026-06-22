import type { Facing } from '../types';

// `·` (U+00B7) marks a transparent cell: visible in the editor and survives
// trailing-whitespace trimming, unlike a literal space (also transparent).
export const SENTINEL = '·';

// Block Elements (U+2580–259F) mirror by swapping lit quadrants across the
// vertical axis (TL↔TR, BL↔BR): e.g. ▌→▐, ▘→▝, ▛→▜. Fully symmetric blocks
// (█ ▀ ▄ space) are self-mirrors and omitted.
const MIRROR: Record<string, string> = {
	'(': ')',
	')': '(',
	'[': ']',
	']': '[',
	'{': '}',
	'}': '{',
	'<': '>',
	'>': '<',
	'/': '\\',
	'\\': '/',
	'`': "'",
	"'": '`',
	'▌': '▐',
	'▐': '▌',
	'▘': '▝',
	'▝': '▘',
	'▖': '▗',
	'▗': '▖',
	'▛': '▜',
	'▜': '▛',
	'▙': '▟',
	'▟': '▙',
	'▚': '▞',
	'▞': '▚',
};

// A sprite glyph mapped to its translucent "ghost" form for placement previews
// (#118). Only the FULL block █ fills its whole cell, so it's the one glyph that
// hides the ghost's background tint — map it to a light shade so the tint reads
// through. Every partial "puzzle-shape" block (quadrants/halves like ▟ ▛ ▌) leaves
// part of its cell empty, so the tint already shows through and the silhouette
// stays legible — those pass through unchanged (Unicode has no lighter quadrants).
const GHOST_GLYPHS: Record<string, string> = {
	'█': '░',
};

/** The translucent ghost form of a sprite glyph (#118): the solid full block
 *  becomes a light shade; partial blocks keep their shape. Unknown glyphs (incl.
 *  the light shade itself) pass through unchanged. */
export function ghostGlyph(ch: string): string {
	return GHOST_GLYPHS[ch] ?? ch;
}

function splitTrimPad(art: string): string[] {
	const lines = art.split('\n');
	while (lines.length > 0 && lines[0].trim() === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
	return lines.map((l) => l.padEnd(width, ' '));
}

function mirrorGlyphs(rows: readonly string[]): string[] {
	return rows.map((row) => {
		let out = '';
		for (let i = row.length - 1; i >= 0; i--) out += MIRROR[row[i]] ?? row[i];
		return out;
	});
}

// Colour keys carry no orientation, so mirroring is a plain reverse to keep
// them aligned to the mirrored glyphs.
function reverseRows(rows: readonly string[]): string[] {
	return rows.map((row) => {
		let out = '';
		for (let i = row.length - 1; i >= 0; i--) out += row[i];
		return out;
	});
}

export interface SpriteOptions {
	defaultKey: string;
	/** Colour-key grid aligned cell-for-cell to the glyph grid; `·`/space fall
	 *  back to `defaultKey`. Must match the glyph grid's dimensions. */
	colors?: string;
}

export class Sprite {
	readonly w: number;
	readonly h: number;
	private readonly glyphRight: readonly string[];
	private readonly glyphLeft: readonly string[];
	private readonly colorRight: readonly string[];
	private readonly colorLeft: readonly string[];

	constructor(glyph: string, opts: SpriteOptions) {
		const { defaultKey } = opts;
		if (defaultKey.length !== 1)
			throw new Error(
				`Sprite defaultKey must be a single char, got "${defaultKey}"`,
			);

		const glyphRows = splitTrimPad(glyph).map((r) =>
			r.replaceAll(SENTINEL, ' '),
		);
		this.h = glyphRows.length;
		this.w = glyphRows.length > 0 ? glyphRows[0].length : 0;

		let colorRows: string[];
		if (opts.colors === undefined) {
			colorRows = glyphRows.map((r) => defaultKey.repeat(r.length));
		} else {
			const parsed = splitTrimPad(opts.colors);
			const cw = parsed.length > 0 ? parsed[0].length : 0;
			if (parsed.length !== this.h || cw !== this.w)
				throw new Error(
					`Sprite colour grid (${cw}x${parsed.length}) must match glyph grid (${this.w}x${this.h})`,
				);
			colorRows = parsed.map((r) =>
				Array.from(r, (c) =>
					c === SENTINEL || c === ' ' ? defaultKey : c,
				).join(''),
			);
		}

		this.glyphRight = glyphRows;
		this.glyphLeft = mirrorGlyphs(glyphRows);
		this.colorRight = colorRows;
		this.colorLeft = reverseRows(colorRows);
	}

	rows(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.glyphRight : this.glyphLeft;
	}

	colorKeys(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.colorRight : this.colorLeft;
	}
}
