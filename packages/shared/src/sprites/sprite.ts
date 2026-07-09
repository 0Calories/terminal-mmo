import type { Facing } from '../types';

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
	grip?: { x: number; y: number };
	baseline?: number;
}

export class Sprite {
	readonly w: number;
	readonly h: number;
	readonly defaultKey: string;
	readonly grip?: { x: number; y: number };
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
