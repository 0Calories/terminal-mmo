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
	"animations": { "walkA": ["fa", "fb"] },
	"fps": { "walkA": 8 },
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
	const walk = body.frames.walkA;
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

	const walkArr = body.frames.walkA as readonly Sprite[];
	// fa inherits doc anchors; fb overrides grip (frame wins), keeps head
	expect(walkArr[0].anchors.grip).toEqual({ x: 1, y: 0 });
	expect(walkArr[0].anchors.head).toEqual({ x: 0, y: 0 });
	expect(walkArr[1].anchors.grip).toEqual({ x: 1, y: 1 });
	expect(walkArr[1].anchors.head).toEqual({ x: 0, y: 0 });
});

test('compileBodySprite: fps is carried from the doc', () => {
	const { doc } = parseSpriteFile(BODY, 'buddy');
	const body = compileBodySprite(doc as SpriteDoc);
	expect(body.fps).toEqual({ walkA: 8 });
});

test('compileBodySprite: throws when doc-level grip/head anchors are missing', () => {
	const { doc } = parseSpriteFile(`--- idle\nAB\nCD\n`, 'noanchors');
	expect(() => compileBodySprite(doc as SpriteDoc)).toThrow();
});

const WEAPON = `{
	"key": "a",
	"accent": "s",
	"anchors": { "grip": [-1, 2] }
}
--- idle
AB
--- windup
CD
--- active
EF
--- recovery
GH
`;

test('compileWeaponSprite: phase animations compile — idle/windup/recovery single, active is a sweep array', () => {
	const { doc, diagnostics } = parseSpriteFile(WEAPON, 'sword');
	// The negative grip trips only the out-of-bounds warning, never an error.
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
	const ws = compileWeaponSprite(doc as SpriteDoc);

	expect(Array.isArray(ws.frames.idle)).toBe(false);
	expect((ws.frames.idle as Sprite).rows(1)).toEqual(['AB']);
	expect((ws.frames.windup as Sprite).rows(1)).toEqual(['CD']);
	expect((ws.frames.recovery as Sprite).rows(1)).toEqual(['GH']);

	expect(Array.isArray(ws.frames.active)).toBe(true);
	expect(ws.frames.active?.length).toBe(1);
	expect(ws.frames.active?.[0].rows(1)).toEqual(['EF']);
});

test('compileWeaponSprite: grip (a negative offset) and accent carry onto the WeaponSprite', () => {
	const { doc } = parseSpriteFile(WEAPON, 'sword');
	const ws = compileWeaponSprite(doc as SpriteDoc);
	expect(ws.grip).toEqual({ x: -1, y: 2 });
	expect(ws.accent).toBe('s');
});

test('compileWeaponSprite: recovery absent round-trips to no recovery frame', () => {
	const noRecovery = `{ "accent": "s", "anchors": { "grip": [0, 0] } }
--- idle
AB
--- windup
CD
--- active
EF
`;
	const { doc } = parseSpriteFile(noRecovery, 'sword');
	const ws = compileWeaponSprite(doc as SpriteDoc);
	expect(ws.frames.recovery).toBeUndefined();
});

test('compileWeaponSprite: defaults accent to the dynamic accent key when the header omits it', () => {
	const noAccent = `{ "anchors": { "grip": [0, 0] } }
--- idle
AB
--- windup
CD
--- active
EF
`;
	const { doc } = parseSpriteFile(noAccent, 'sword');
	const ws = compileWeaponSprite(doc as SpriteDoc);
	expect(ws.accent).toBe(WEAPON_ACCENT_KEY);
});

test('compileWeaponSprite: throws when the grip anchor is missing', () => {
	const { doc } = parseSpriteFile(
		`--- idle\nAB\n--- windup\nCD\n--- active\nEF\n`,
		'nogrip',
	);
	expect(() => compileWeaponSprite(doc as SpriteDoc)).toThrow();
});
