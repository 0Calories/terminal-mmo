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
	'╱': '╲',
	'╲': '╱',
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

// Mirror a single glyph across the vertical axis (the block-element / bracket swap
// table above), or return it unchanged if it has no distinct mirror. Exposed so the
// combat layer can orient a weapon's pose glyph by facing with the SAME table the
// sprite mirroring uses, instead of duplicating the map (ADR 0017 §13b).
export function mirrorGlyph(glyph: string): string {
	return MIRROR[glyph] ?? glyph;
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
	/** A named anchor cell in the (right-facing) art that another layer aligns to —
	 *  the body template's **grip cell** (the hand position) is declared here, the
	 *  same data-driven mechanism as the cosmetic hat's head placement (ADR 0018 §3).
	 *  The weapon layer composites grip-to-grip onto this cell; facing-left mirrors
	 *  the column across the body via the renderer. Absent for art with no anchor. */
	grip?: { x: number; y: number };
	/** Vertical anchor offset (cells, default `0`): added to the sprite's `sy` so the
	 *  whole figure shifts as a unit, landing its bottom row on the terrain surface
	 *  row instead of one cell above. `1` for ink-top "contact feet" art that should
	 *  plant on the ground; `0` for full-block / lower-ink feet that already touch it
	 *  (ADR 0021). The legacy single-frame Monster path reads it here; a Form declares
	 *  its own on the BodySprite so it applies across the whole frame set. */
	baseline?: number;
}

export class Sprite {
	readonly w: number;
	readonly h: number;
	// The fallback colour key for any cell without an explicit one — the entity's
	// dominant body colour, reused as its death-gore tint (#139).
	readonly defaultKey: string;
	// A named anchor cell (right-facing art coords) another layer aligns to — the
	// body's grip cell for the weapon layer (ADR 0018 §3). Undefined when unanchored.
	readonly grip?: { x: number; y: number };
	// Vertical anchor offset (cells, default 0): shifts the whole sprite down so its
	// bottom row plants on the terrain surface row (ADR 0021). Read by the renderer's
	// `sy` for the legacy single-frame Monster path; a Form carries its own baseline.
	readonly baseline: number;
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
		this.defaultKey = defaultKey;
		this.grip = opts.grip;
		this.baseline = opts.baseline ?? 0;

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
