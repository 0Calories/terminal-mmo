import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc } from '../src';
import { spriteFromDoc } from '../src/sprite-compile';

const RICH = `{
	"key": "e",
	"baseline": 2,
	"anchors": { "grip": [1, 0] },
	"frames": { "idle": { "anchors": { "grip": [0, 1] } } },
	"colors": { "q": [1, 2, 3, 255], "r": [4, 5, 6, 255], "s": [7, 8, 9, 255] }
}
--- idle
AB
CD
@colors
qe
eq
@bg
sr
rs
--- other
XY
ZW
`;

test('compiles a single frame doc with transparency, custom key, colors, bg, baseline, grip', () => {
	const { doc, diagnostics } = parseSpriteFile(RICH, 'rich');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'idle');

	expect(sprite.rows(1)).toEqual(['AB', 'CD']);
	expect(sprite.colorKeys(1)).toEqual(['qe', 'eq']);
	expect(sprite.bgKeys(1)).toEqual(['sr', 'rs']);
	expect(sprite.w).toBe(2);
	expect(sprite.h).toBe(2);
	expect(sprite.baseline).toBe(2);
	// frame-level grip override wins over doc-level grip
	expect(sprite.grip).toEqual({ x: 0, y: 1 });
});

const EDGE_TRANSPARENCY = `--- idle
·AB·
·CD·
`;

test('transparency at edges is preserved (nothing trimmed away)', () => {
	const { doc, diagnostics } = parseSpriteFile(EDGE_TRANSPARENCY, 'edge');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'idle');
	expect(sprite.w).toBe(4);
	expect(sprite.h).toBe(2);
	expect(sprite.rows(1)).toEqual([' AB ', ' CD ']);
});

const MULTI_FRAME = `--- idle
AB
CD
--- walk
XY
ZW
`;

test('selects frame by name', () => {
	const { doc, diagnostics } = parseSpriteFile(MULTI_FRAME, 'multi');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'walk');
	expect(sprite.rows(1)).toEqual(['XY', 'ZW']);
});

test('falls back to first frame when named frame is missing', () => {
	const { doc, diagnostics } = parseSpriteFile(MULTI_FRAME, 'multi');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'nonexistent');
	expect(sprite.rows(1)).toEqual(['AB', 'CD']);
});

const ASYMMETRIC = `--- idle
(AB
·CD
`;

test('mirrored facing works and does not throw', () => {
	const { doc, diagnostics } = parseSpriteFile(ASYMMETRIC, 'asym');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'idle');
	const right = sprite.rows(1);
	const left = sprite.rows(-1);
	expect(right).toEqual(['(AB', ' CD']);
	expect(left).not.toEqual(right);
	// row reversed, and '(' mirrors to ')'
	expect(left).toEqual(['BA)', 'DC ']);
});

const NO_COLORS_NO_BG = `--- idle
AB
CD
`;

test('omitted colors/bg default to doc key on inked cells', () => {
	const { doc, diagnostics } = parseSpriteFile(NO_COLORS_NO_BG, 'plain');
	expect(diagnostics).toEqual([]);
	const sprite = spriteFromDoc(doc as SpriteDoc, 'idle');
	expect(sprite.colorKeys(1)).toEqual(['pp', 'pp']);
	expect(sprite.bgKeys(1)).toEqual(['  ', '  ']);
});
