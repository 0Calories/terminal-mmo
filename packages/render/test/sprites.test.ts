import { expect, test } from 'bun:test';
import { loadSpriteSources } from '@mmo/assets';
import { type RGBAQuad, SCENE_COLORS, SCENE_PALETTE } from '@mmo/core/entities';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import {
	compileSprite,
	paintSprite,
	type SpritePalette,
} from '@mmo/render/sprites';
import { parseSpriteFile, type SpriteDoc } from '../src';

const SCENE: SpritePalette = Object.fromEntries(
	Object.entries(SCENE_PALETTE).map(([k, q]) => [k, [...q] as RGBA]),
);
const DEFAULT: RGBA = [...SCENE_COLORS.paletteDefault];

function q(key: keyof typeof SCENE_PALETTE): RGBA {
	return [...(SCENE_PALETTE[key] as RGBAQuad)];
}

const M = q('m'); // chaser ink
const O = q('o'); // shooter ink
const Y = q('y'); // party-hat point
const TRANSPARENT: RGBA = [0, 0, 0, 0];

const sources = loadSpriteSources();
function shippedDoc(id: string): SpriteDoc {
	const source = sources.get(id);
	if (source === undefined) throw new Error(`missing shipped sprite '${id}'`);
	const { doc, diagnostics } = parseSpriteFile(source.text, id);
	if (doc === null)
		throw new Error(
			`sprite '${id}' failed to parse: ${JSON.stringify(diagnostics)}`,
		);
	return doc;
}

function paintScene(
	compositor: Compositor,
	doc: SpriteDoc,
	cellX: number,
	cellY: number,
	recolor?: SpritePalette,
): void {
	paintSprite(compositor, compileSprite(doc), {
		cellX,
		cellY,
		palette: SCENE,
		paletteDefault: DEFAULT,
		...(recolor !== undefined ? { recolor } : {}),
	});
}

test('compiling and painting a shipped sprite reveals its quadrant pixels as cells', () => {
	const c = new Compositor(8, 6);
	paintScene(c, shippedDoc('shooter'), 0, 0);

	// A partial top-edge cell keeps its transparent quadrants transparent.
	expect(c.cell(0, 1)).toEqual({ char: '▟', fg: O, bg: TRANSPARENT });
	// A fully-inked interior cell is a solid block of the ink colour.
	expect(c.cell(0, 2)).toEqual({ char: '█', fg: O, bg: O });
});

test('a front sprite’s transparent quadrants reveal the sprite behind it', () => {
	const c = new Compositor(8, 8);
	// shooter behind, chaser one cell lower so its top row overlaps shooter's body.
	paintScene(c, shippedDoc('shooter'), 0, 0);
	paintScene(c, shippedDoc('chaser'), 0, 1);

	// chaser's '▚' inks the TL and BR quadrants; the TR and BL it leaves
	// transparent must show shooter's '▟' underneath (o), not a black/box bg.
	expect(c.cell(0, 1)).toEqual({ char: '▚', fg: M, bg: O });
});

test('a transparent Glyph stamp inherits the dominant composed backdrop', () => {
	const c = new Compositor(8, 6);
	paintScene(c, shippedDoc('shooter'), 0, 0);
	// party-hat's '▲' has no authored bg; over shooter's '▄' cell it takes the
	// dominant underlying colour (o) as its backdrop.
	paintScene(c, shippedDoc('party-hat'), 0, 0);

	expect(c.cell(2, 0)).toEqual({ char: '▲', fg: Y, bg: O });
});

test('recolor overrides a colour key at paint time without recompiling', () => {
	const doc = shippedDoc('chaser');
	const compiled = compileSprite(doc);
	const blue: RGBA = [10, 20, 200, 255];
	const c = new Compositor(8, 6);
	paintSprite(c, compiled, {
		cellX: 0,
		cellY: 0,
		palette: SCENE,
		paletteDefault: DEFAULT,
		recolor: { m: blue },
	});
	// '▟' at (2,0) is chaser ink 'm', now recoloured at paint time.
	expect(c.cell(2, 0)).toEqual({ char: '▟', fg: blue, bg: TRANSPARENT });
});

test('a doc-local palette colour resolves beneath an empty scene palette', () => {
	const text = `{
	"animations": [{ "name": "idle" }],
	"colors": { "z": [12, 34, 56, 255] }
}
--- idle
█
@colors
z
`;
	const { doc } = parseSpriteFile(text, 'local');
	const compiled = compileSprite(doc as SpriteDoc);
	const c = new Compositor(1, 1);
	paintSprite(c, compiled, {
		cellX: 0,
		cellY: 0,
		palette: {},
		paletteDefault: DEFAULT,
	});
	expect(c.cell(0, 0)).toEqual({
		char: '█',
		fg: [12, 34, 56, 255],
		bg: [12, 34, 56, 255],
	});
});

test('compilation is deterministic', () => {
	const doc = shippedDoc('chaser');
	expect(compileSprite(doc)).toEqual(compileSprite(doc));
});

test('facing left mirrors the compiled pixels', () => {
	const doc = shippedDoc('shooter');
	const right = new Compositor(8, 6);
	const left = new Compositor(8, 6);
	paintSprite(right, compileSprite(doc), {
		cellX: 0,
		cellY: 0,
		facing: 1,
		palette: SCENE,
		paletteDefault: DEFAULT,
	});
	paintSprite(left, compileSprite(doc), {
		cellX: 0,
		cellY: 0,
		facing: -1,
		palette: SCENE,
		paletteDefault: DEFAULT,
	});
	// shooter is left/right symmetric, so mirroring must reproduce it exactly.
	expect(left.surface()).toEqual(right.surface());
});

test('a Glyph stamp wider than one column is rejected at compile time', () => {
	const text = `{
	"animations": [{ "name": "idle" }]
}
--- idle
＠
`;
	const { doc } = parseSpriteFile(text, 'wide');
	expect(() => compileSprite(doc as SpriteDoc)).toThrow(/terminal columns/);
});

test('a one-column Glyph stamp compiles without error', () => {
	expect(() => compileSprite(shippedDoc('party-hat'))).not.toThrow();
});
