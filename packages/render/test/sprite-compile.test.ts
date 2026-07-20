import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc, WEAPON_ACCENT_KEY } from '../src';
import type { Sprite } from '../src/sprite';
import {
	compileBodySprite,
	compileWeaponSprite,
	spriteFromDoc,
} from '../src/sprite-compile';

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

const ANCHORED = `{
	"anchors": { "grip": [1, 0], "head": [1, 1], "tail": [0, 1] },
	"frames": { "sit": { "anchors": { "head": [0, 0] } } }
}
--- idle
AB
CD
--- sit
XY
ZW
`;

test('spriteFromDoc carries the full effective anchor map, not just grip (#351 QA round 5)', () => {
	const { doc, diagnostics } = parseSpriteFile(ANCHORED, 'anchored');
	expect(diagnostics).toEqual([]);
	// Default frame: doc-level anchors flow through untouched.
	const idle = spriteFromDoc(doc as SpriteDoc, 'idle');
	expect(idle.anchors).toEqual({
		grip: { x: 1, y: 0 },
		head: { x: 1, y: 1 },
		tail: { x: 0, y: 1 },
	});
	// Overriding frame: its head override wins; every other anchor falls
	// back to the doc level — exactly compileFrameSprite's overlay rule.
	const sit = spriteFromDoc(doc as SpriteDoc, 'sit');
	expect(sit.anchors).toEqual({
		grip: { x: 1, y: 0 },
		head: { x: 0, y: 0 },
		tail: { x: 0, y: 1 },
	});
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

const BODY = `{
	"baseline": 1,
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": { "walk": ["fa", "fb"] },
	"fps": { "walk": 8 },
	"frames": { "fb": { "anchors": { "grip": [1, 1] } } }
}
--- idle
XY
ZW
--- fa
AB
CD
--- fb
EF
GH
`;

test('compileBodySprite: multi-frame animation is an array, single-frame is a Sprite', () => {
	const { doc, diagnostics } = parseSpriteFile(BODY, 'buddy');
	expect(diagnostics).toEqual([]);
	const body = compileBodySprite(doc as SpriteDoc);

	// multi-frame animation -> array
	const walk = body.frames.walk;
	expect(Array.isArray(walk)).toBe(true);
	const walkArr = walk as readonly Sprite[];
	expect(walkArr.length).toBe(2);
	expect(walkArr[0].rows(1)).toEqual(['AB', 'CD']);
	expect(walkArr[1].rows(1)).toEqual(['EF', 'GH']);

	// implicit single-frame animation -> Sprite, not array
	const idle = body.frames.idle;
	expect(Array.isArray(idle)).toBe(false);
	expect((idle as Sprite).rows(1)).toEqual(['XY', 'ZW']);
});

test('compileBodySprite: doc-level anchors seed body grip/head and frame anchors', () => {
	const { doc } = parseSpriteFile(BODY, 'buddy');
	const body = compileBodySprite(doc as SpriteDoc);

	expect(body.grip).toEqual({ x: 1, y: 0 });
	expect(body.head).toEqual({ x: 0, y: 0 });
	expect(body.baseline).toBe(1);

	const walkArr = body.frames.walk as readonly Sprite[];
	// fa inherits doc anchors; fb overrides grip (frame wins), keeps head
	expect(walkArr[0].anchors.grip).toEqual({ x: 1, y: 0 });
	expect(walkArr[0].anchors.head).toEqual({ x: 0, y: 0 });
	expect(walkArr[1].anchors.grip).toEqual({ x: 1, y: 1 });
	expect(walkArr[1].anchors.head).toEqual({ x: 0, y: 0 });
});

test('compileBodySprite: fps is carried from the doc', () => {
	const { doc } = parseSpriteFile(BODY, 'buddy');
	const body = compileBodySprite(doc as SpriteDoc);
	expect(body.fps).toEqual({ walk: 8 });
});

test('compileBodySprite: throws when doc-level grip/head anchors are missing', () => {
	const { doc } = parseSpriteFile(`--- idle\nAB\nCD\n`, 'noanchors');
	expect(() => compileBodySprite(doc as SpriteDoc)).toThrow();
});

const WEAPON = `{
	"key": "a",
	"accent": "s",
	"anchors": { "grip": [-1, 2] },
	"animations": { "swing": ["swing-0", "swing-1", "swing-2"] }
}
--- idle
AB
--- swing-0
CD
--- swing-1
EF
--- swing-2
GH
`;

test('compileWeaponSprite: the Default frame is the rest sprite; swing is a 3-frame phase array (ADR 0036)', () => {
	const { doc, diagnostics } = parseSpriteFile(WEAPON, 'sword');
	// The negative grip trips only the out-of-bounds warning, never an error.
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
	const ws = compileWeaponSprite(doc as SpriteDoc);

	expect(ws.frames.rest.rows(1)).toEqual(['AB']);
	expect(ws.frames.swing).toHaveLength(3);
	expect(ws.frames.swing[0].rows(1)).toEqual(['CD']);
	expect(ws.frames.swing[1].rows(1)).toEqual(['EF']);
	expect(ws.frames.swing[2].rows(1)).toEqual(['GH']);
});

test('compileWeaponSprite: grip (a negative offset) and accent carry onto the WeaponSprite', () => {
	const { doc } = parseSpriteFile(WEAPON, 'sword');
	const ws = compileWeaponSprite(doc as SpriteDoc);
	expect(ws.grip).toEqual({ x: -1, y: 2 });
	expect(ws.accent).toBe('s');
});

test('compileWeaponSprite: defaults accent to the dynamic accent key when the header omits it', () => {
	const noAccent = `{ "anchors": { "grip": [0, 0] }, "animations": { "swing": ["s0", "s1", "s2"] } }
--- idle
AB
--- s0
CD
--- s1
EF
--- s2
GH
`;
	const { doc } = parseSpriteFile(noAccent, 'sword');
	const ws = compileWeaponSprite(doc as SpriteDoc);
	expect(ws.accent).toBe(WEAPON_ACCENT_KEY);
});

test('compileWeaponSprite: throws when the grip anchor or the 3-frame swing is missing', () => {
	const { doc: nogrip } = parseSpriteFile(
		`{ "animations": { "swing": ["a", "b", "c"] } }\n--- idle\nAB\n--- a\nAB\n--- b\nAB\n--- c\nAB\n`,
		'nogrip',
	);
	expect(() => compileWeaponSprite(nogrip as SpriteDoc)).toThrow();
	const { doc: noswing } = parseSpriteFile(
		`{ "anchors": { "grip": [0, 0] } }\n--- idle\nAB\n`,
		'noswing',
	);
	expect(() => compileWeaponSprite(noswing as SpriteDoc)).toThrow();
});
