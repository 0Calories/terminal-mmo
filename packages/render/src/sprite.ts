import type { Facing } from '@mmo/core';

// `·` (U+00B7): a transparent cell that survives whitespace trimming, unlike a space.
export const SENTINEL = '·';

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

function reverseRows(rows: readonly string[]): string[] {
	return rows.map((row) => {
		let out = '';
		for (let i = row.length - 1; i >= 0; i--) out += row[i];
		return out;
	});
}

export interface SpriteOptions {
	defaultKey: string;
	colors?: string;
	// Per-cell bg key (ADR 0031). A cell is either one color + transparency
	// (the `colors` channel) or two colors fully opaque — never both.
	bg?: string;
	grip?: { x: number; y: number };
	baseline?: number;
	// Named seat points (ADR 0031), e.g. `grip` (weapon) and `head` (hat). The
	// legacy `grip` option folds into this map when set. Frames carry their own
	// per-frame overrides here; the renderer prefers a frame's anchor over the
	// BodySprite's.
	anchors?: Readonly<Record<string, { x: number; y: number }>>;
}

export class Sprite {
	readonly w: number;
	readonly h: number;
	readonly defaultKey: string;
	readonly grip?: { x: number; y: number };
	readonly anchors: Readonly<Record<string, { x: number; y: number }>>;
	readonly baseline: number;
	private readonly glyphRight: readonly string[];
	private readonly glyphLeft: readonly string[];
	private readonly colorRight: readonly string[];
	private readonly colorLeft: readonly string[];
	private readonly bgRight: readonly string[];
	private readonly bgLeft: readonly string[];

	constructor(glyph: string, opts: SpriteOptions) {
		const { defaultKey } = opts;
		if (defaultKey.length !== 1)
			throw new Error(
				`Sprite defaultKey must be a single char, got "${defaultKey}"`,
			);
		this.defaultKey = defaultKey;
		this.grip = opts.grip;
		const anchors: Record<string, { x: number; y: number }> = {
			...(opts.anchors ?? {}),
		};
		if (opts.grip !== undefined && !('grip' in anchors))
			anchors.grip = opts.grip;
		this.anchors = anchors;
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

		let bgRows: string[];
		if (opts.bg === undefined) {
			bgRows = glyphRows.map((r) => ' '.repeat(r.length));
		} else {
			const parsed = splitTrimPad(opts.bg);
			const bw = parsed.length > 0 ? parsed[0].length : 0;
			if (parsed.length !== this.h || bw !== this.w)
				throw new Error(
					`Sprite bg grid (${bw}x${parsed.length}) must match glyph grid (${this.w}x${this.h})`,
				);
			bgRows = parsed.map((r) =>
				Array.from(r, (c) => (c === SENTINEL || c === ' ' ? ' ' : c)).join(''),
			);
			for (let y = 0; y < bgRows.length; y++) {
				for (let x = 0; x < bgRows[y].length; x++) {
					if (bgRows[y][x] !== ' ' && glyphRows[y][x] === ' ')
						throw new Error(`Sprite bg key on transparent cell at (${x},${y})`);
				}
			}
		}

		this.glyphRight = glyphRows;
		this.glyphLeft = mirrorGlyphs(glyphRows);
		this.colorRight = colorRows;
		this.colorLeft = reverseRows(colorRows);
		this.bgRight = bgRows;
		this.bgLeft = reverseRows(bgRows);
	}

	rows(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.glyphRight : this.glyphLeft;
	}

	colorKeys(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.colorRight : this.colorLeft;
	}

	bgKeys(facing: Facing = 1): readonly string[] {
		return facing === 1 ? this.bgRight : this.bgLeft;
	}
}
