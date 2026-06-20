// Sprite: the shared machinery for ASCII-art figures (ADR 0003). It owns art
// parsing, dimensions, mirroring, and per-cell colour *keys* — and nothing
// about buffers, cameras, screen colour, or entities. That keeps it pure and
// unit-testable, and lets non-entity art (terrain, buildings, items) reuse it.
//
// Authoring rules for the glyph/colour template strings:
//   - Write rows flush-left, one row per line.
//   - `·` (U+00B7) marks a transparent cell. It's visible in the editor (so the
//     silhouette reads true) and survives trailing-whitespace trimming; the
//     constructor maps it to a space (a literal space is transparent too).
//   - Escape `\` as `\\` and a backtick as `` \` `` (normal template-literal rules).
import type { Facing } from '@mmo/shared';

/** Author-facing transparent-cell marker; converted to a space at runtime. */
export const SENTINEL = '·';

/** Glyphs that visually flip when a sprite faces the other way. */
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
};

/** Split a template-literal art block into normalised rows: drop the leading
 *  and trailing blank lines (template-literal artifacts) and right-pad ragged
 *  rows so every row is the same (max) width. */
function splitTrimPad(art: string): string[] {
	const lines = art.split('\n');
	while (lines.length > 0 && lines[0].trim() === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
	return lines.map((l) => l.padEnd(width, ' '));
}

/** Flip glyph rows for the opposite facing: reverse each row and swap the
 *  glyphs that have a mirror image (brackets, slashes, quotes). */
function mirrorGlyphs(rows: readonly string[]): string[] {
	return rows.map((row) => {
		let out = '';
		for (let i = row.length - 1; i >= 0; i--) out += MIRROR[row[i]] ?? row[i];
		return out;
	});
}

/** Flip colour-key rows for the opposite facing: reverse only — keys carry no
 *  orientation, they just need to stay aligned to the mirrored glyphs. */
function reverseRows(rows: readonly string[]): string[] {
	return rows.map((row) => {
		let out = '';
		for (let i = row.length - 1; i >= 0; i--) out += row[i];
		return out;
	});
}

export interface SpriteOptions {
	/** Single-char palette key applied to every cell with no explicit colour. */
	defaultKey: string;
	/** Optional colour-key grid, aligned cell-for-cell to the glyph grid. Each
	 *  cell is a single-char palette key; `·`/space fall back to `defaultKey`.
	 *  Omit for a mono-colour sprite. Must match the glyph grid's dimensions. */
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

	/** Glyph rows for the given facing (transparent cells are spaces). */
	rows(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.glyphRight : this.glyphLeft;
	}

	/** Colour-key rows for the given facing, aligned cell-for-cell to `rows`. */
	colorKeys(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.colorRight : this.colorLeft;
	}
}
