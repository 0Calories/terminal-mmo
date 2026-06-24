import { expect, test } from 'bun:test';
import { BOX } from '../src/constants';
import {
	type CellBuffer,
	drawEntitySprite,
	type RenderStyle,
	renderZoneScene,
} from '../src/render';
import { HATS, type Sprite, spriteFor, spriteForNpc } from '../src/sprites';
import { parseTerrain } from '../src/terrain';
import type { Entity, EntityType, Facing } from '../src/types';
import { weaponById } from '../src/weapons';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	// True when written via setCellWithAlphaBlending (translucent), so tests can tell
	// an opaque frame cell from a terrain-revealing interior cell (ADR 0016).
	blended?: boolean;
}

// A framework-agnostic stand-in for opentui's OptimizedBuffer: records the last
// cell written at each (x,y) so tests can assert glyphs/colours without a renderer.
class FakeBuffer implements CellBuffer<string> {
	readonly width: number;
	readonly height: number;
	cells = new Map<string, Cell>();
	cleared: string | null = null;

	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
	}

	clear(bg: string): void {
		this.cleared = bg;
		this.cells.clear();
	}

	setCell(x: number, y: number, ch: string, fg: string, bg: string): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg });
	}

	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: string,
		bg: string,
	): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg, blended: true });
	}

	at(x: number, y: number): Cell | undefined {
		return this.cells.get(`${x},${y}`);
	}
}

// Assert a sprite's lit glyphs landed at the given top-left anchor, with palette
// colours. Expectations are derived from the same Sprite the renderer uses, so
// the test survives art iteration (it pins placement/wiring, not appearance).
function expectSpriteAt(
	buf: FakeBuffer,
	sprite: Sprite,
	ax: number,
	ay: number,
	facing: Facing,
	expectedFg: (key: string) => string,
) {
	const glyphs = sprite.rows(facing);
	const keys = sprite.colorKeys(facing);
	for (let ry = 0; ry < sprite.h; ry++) {
		for (let rx = 0; rx < sprite.w; rx++) {
			const ch = glyphs[ry][rx];
			if (ch === ' ') continue;
			const cell = buf.at(ax + rx, ay + ry);
			expect(cell?.ch).toBe(ch);
			expect(cell?.fg).toBe(expectedFg(keys[ry][rx]));
		}
	}
}

const STYLE: RenderStyle<string> = {
	bg: 'BG',
	terrainFg: 'TFG',
	terrainBg: 'TBG',
	portal: 'PORTAL',
	transparent: 'TR',
	hurt: 'HURT',
	nameplate: 'NAME',
	nameplateWash: 'WASH',
	palette: {
		p: 'cP',
		m: 'cM',
		g: 'cG',
		s: 'cS',
		w: 'cW',
		y: 'cY',
		e: 'cE',
		f: 'cF',
		c: 'cC',
		o: 'cO',
		k: 'cK',
	},
	paletteDefault: 'DEF',
	cosmetics: {
		// Distinct sentinels per index so a test can assert which catalog slot was used.
		hues: ['hue0', 'hue1', 'hue2', 'hue3', 'hue4', 'hue5', 'hue6', 'hue7'],
		nameplates: ['np0', 'np1', 'np2', 'np3', 'np4', 'np5', 'np6', 'np7'],
		nameplateWashes: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'],
	},
};

const fgFor = (key: string) => STYLE.palette[key] ?? STYLE.paletteDefault;

function makeEntity(over: Partial<Entity> & { type: EntityType }): Entity {
	return {
		id: 1,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

const flat20 = () =>
	parseTerrain(Array.from({ length: 16 }, () => '.'.repeat(20)));

test('terrain: solid cells render as a block; empty cells stay cleared', () => {
	// 6 wide, 4 tall, a single solid cell at world (3, 2).
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.cleared).toBe('BG');
	expect(buf.at(3, 2)).toEqual({ ch: '█', fg: 'TFG', bg: 'TBG' });
	expect(buf.at(0, 0)).toBeUndefined();
});

test('terrain scrolls with the camera', () => {
	// Solid at world (3, 2); camera at (2, 1) shifts it to screen (1, 1).
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 2, y: 1 },
		STYLE,
	);

	expect(buf.at(1, 1)).toEqual({ ch: '█', fg: 'TFG', bg: 'TBG' });
	expect(buf.at(3, 2)).toBeUndefined();
});

test('portals render as a translucent block across their box', () => {
	const terrain = parseTerrain(['......', '......', '......', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{
			terrain,
			portals: [
				{ x: 1, y: 1, w: 2, h: 2, target: 'town-01', arrival: { x: 0, y: 0 } },
			],
			npcs: [],
			entities: [],
		},
		{ x: 0, y: 0 },
		STYLE,
	);

	for (const [x, y] of [
		[1, 1],
		[2, 1],
		[1, 2],
		[2, 2],
	]) {
		expect(buf.at(x, y)).toEqual({
			ch: '▒',
			fg: 'PORTAL',
			bg: 'TR',
			blended: true,
		});
	}
});

test('ghost mode keeps every glyph as-is and fades the colour over the tint (#118)', () => {
	const buf = new FakeBuffer(20, 16);
	// The shooter sprite has both solid full blocks and partial puzzle-shape blocks;
	// every one must survive unchanged (no glyph swap) — only the colour is faded.
	const e = makeEntity({ type: 'shooter', x: 6, y: 6 });
	const fade = (fg: string) => `FADED(${fg})`;
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE, { bg: 'TINT', fade });

	const sprite = spriteFor('shooter');
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const sy = Math.round(e.y + BOX.h - sprite.h);
	const glyphs = sprite.rows(1);
	const keys = sprite.colorKeys(1);
	let sawSolid = false;
	let sawPartial = false;
	let sawFilledGap = false;
	for (let ry = 0; ry < sprite.h; ry++) {
		for (let rx = 0; rx < sprite.w; rx++) {
			const ch = glyphs[ry][rx];
			const cell = buf.at(sx + rx, sy + ry);
			// Every cell in the sprite's bounding box carries the tint — lit OR
			// transparent — so the footprint reads as one solid rectangle (#118).
			expect(cell?.bg).toBe('TINT');
			if (ch === ' ') {
				expect(cell?.ch).toBe(' '); // a transparent cell, filled with the tint
				sawFilledGap = true;
				continue;
			}
			expect(cell?.ch).toBe(ch); // glyph kept exactly — no swap
			expect(cell?.fg).toBe(fade(fgFor(keys[ry][rx]))); // colour run through fade
			if (ch === '█')
				sawSolid = true; // a solid full block...
			else sawPartial = true; // ...and a puzzle-shape block both survive
		}
	}
	expect(sawSolid && sawPartial && sawFilledGap).toBe(true);
});

test('NPC sprite blits at its box anchor (centred over the box, feet on the floor)', () => {
	const terrain = parseTerrain(
		Array.from({ length: 16 }, () => '.'.repeat(20)),
	);
	const buf = new FakeBuffer(20, 16);
	const npc = {
		id: 1,
		x: 5,
		y: 6,
		w: 4,
		h: 5,
		kind: 'vendor' as const,
		name: 'Sage',
	};

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [npc], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = spriteForNpc('vendor');
	const ax = Math.round(npc.x + Math.floor((npc.w - sprite.w) / 2));
	const ay = Math.round(npc.y + npc.h - sprite.h);
	expectSpriteAt(buf, sprite, ax, ay, 1, fgFor);
});

test('entity Sprite blits centred over the collision box, feet aligned', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'chaser', x: 8, y: 6, facing: 1 });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = spriteFor('chaser');
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h);
	expectSpriteAt(buf, sprite, ax, ay, 1, fgFor);
});

test('a hurt entity flashes: every glyph painted with the hurt colour', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'chaser', x: 8, y: 6, hurtT: 0.5 });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = spriteFor('chaser');
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h);
	expectSpriteAt(buf, sprite, ax, ay, 1, () => 'HURT');
});

test('entities are z-ordered by y: a lower entity is drawn over a higher one', () => {
	const buf = new FakeBuffer(20, 16);
	// Same x; `front` has the larger y, so it must overdraw `back` where they meet.
	const back = makeEntity({ id: 1, type: 'chaser', x: 8, y: 5 });
	const front = makeEntity({ id: 2, type: 'player', x: 8, y: 6 });

	renderZoneScene(
		buf,
		// Deliberately passed back-to-front out of order to prove the renderer sorts.
		{ terrain: flat20(), portals: [], npcs: [], entities: [front, back] },
		{ x: 0, y: 0 },
		STYLE,
	);

	// front's sprite top row should win over back's overlapping body.
	const sprite = spriteFor('player');
	const ax = Math.round(front.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(front.y + BOX.h - sprite.h);
	const glyphs = sprite.rows(1);
	for (let rx = 0; rx < sprite.w; rx++) {
		const ch = glyphs[0][rx];
		if (ch === ' ') continue;
		expect(buf.at(ax + rx, ay)?.ch).toBe(ch);
	}
});

// A terrain whose only solid rows are the two the chip occupies, so the whole pill
// samples solid ground (its body is drawn) and the shape can be asserted glyph by glyph.
const terrainUnderChip = (e: Entity) => {
	const boxTop = Math.round(e.y + BOX.h);
	return parseTerrain(
		Array.from({ length: 16 }, (_, r) =>
			(r === boxTop || r === boxTop + 1 ? '#' : '.').repeat(20),
		),
	);
};

test('a named entity gets a 2-row pill nameplate below its sprite', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: terrainUnderChip(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	// The chip top sits on the row directly below the feet (one past the Sprite's last
	// row), centred over the box; its width is the handle + a pad column + a corner each
	// side.
	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// Top row: ▟ · pad · n e o · pad · ▙
	expect(buf.at(left, boxTop)?.ch).toBe('▟');
	expect(buf.at(left + 1, boxTop)?.ch).toBe(' ');
	expect(buf.at(left + 2, boxTop)?.ch).toBe('n');
	expect(buf.at(left + 3, boxTop)?.ch).toBe('e');
	expect(buf.at(left + 4, boxTop)?.ch).toBe('o');
	expect(buf.at(left + 5, boxTop)?.ch).toBe(' ');
	expect(buf.at(left + 6, boxTop)?.ch).toBe('▙');
	// Bottom row: a thin lip with rounded ends — ▝ ▀▀▀▀▀ ▘
	expect(buf.at(left, boxTop + 1)?.ch).toBe('▝');
	expect(buf.at(left + 1, boxTop + 1)?.ch).toBe('▀');
	expect(buf.at(left + 6, boxTop + 1)?.ch).toBe('▘');
});

// --- Cosmetics (#35) -------------------------------------------------------

// The own Avatar is drawn directly (not via the z-ordered scene loop), so the
// cosmetic tests render through drawEntitySprite to pin the per-Avatar overrides.
function avatarTopLeft(e: Entity) {
	const sprite = spriteFor('player');
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h);
	return { sprite, ax, ay };
}

test("cosmetic hue recolours the Avatar's body cells, leaving other keys untouched", () => {
	const buf = new FakeBuffer(20, 16);
	// hue 2 -> 'hue2'; the player sprite is entirely the 'p' body key.
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 2, hat: 0, nameplate: 0 },
	});

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const { sprite, ax, ay } = avatarTopLeft(e);
	expectSpriteAt(buf, sprite, ax, ay, 1, (key) =>
		key === 'p' ? 'hue2' : (STYLE.palette[key] ?? STYLE.paletteDefault),
	);
});

test('a cosmetic hat is overlaid directly above the head', () => {
	const buf = new FakeBuffer(20, 16);
	const hatIdx = 1; // Cap
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: hatIdx, nameplate: 0 },
	});

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const hat = HATS[hatIdx].sprite;
	if (!hat) throw new Error('expected a hat sprite');
	const { sprite, ax, ay } = avatarTopLeft(e);
	const hx = ax + Math.round((sprite.w - hat.w) / 2);
	const hy = ay - hat.h; // bottom row sits on the row above the Sprite top
	expectSpriteAt(
		buf,
		hat,
		hx,
		hy,
		1,
		(key) => STYLE.palette[key] ?? STYLE.paletteDefault,
	);
});

test('an equipped Avatar at rest renders the weapon idle frame at the mirrored grip, on top of the body (ADR 0018)', () => {
	const weapon = weaponById(0).sprite; // default Sword
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	const frame = weapon.frames.idle;
	if (!frame) throw new Error('expected an authored idle frame');

	for (const facing of [1, -1] as Facing[]) {
		const buf = new FakeBuffer(24, 16);
		const e = makeEntity({ type: 'player', x: 10, y: 6, facing, weapon: 0 });
		renderZoneScene(
			buf,
			{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
			{ x: 0, y: 0 },
			STYLE,
		);

		const { sprite: body, ax: sx, ay: sy } = avatarTopLeft(e);
		const grip = body.grip;
		if (!grip) throw new Error('expected the body to declare a grip cell');
		// Body grip cell, its column reflected across the body when facing left.
		const bodyGripX = sx + (facing === 1 ? grip.x : body.w - 1 - grip.x);
		const bodyGripY = sy + grip.y;
		// Weapon grip cell, mirrored alongside the art so grip lands on grip. The grip
		// may sit OUTSIDE the art (a negative column anchoring the blade beside the hand),
		// so it isn't necessarily a drawn cell — placement below is asserted from it.
		const wgx = facing === 1 ? weapon.grip.x : frame.w - 1 - weapon.grip.x;
		const wx: number = bodyGripX - wgx;
		const wy: number = bodyGripY - weapon.grip.y;

		// Every lit weapon glyph landed at the grip-anchored, facing-mirrored position.
		expectSpriteAt(buf, frame, wx, wy, facing, fgFor);

		// Where a lit weapon cell lands on a lit BODY cell, the weapon is drawn on top,
		// so the composited cell shows the weapon glyph — not the body's underneath. Found
		// generically (no assumption about which cell overlaps) so the test survives art
		// iteration; we also assert such an overlap exists, or the on-top check is vacuous.
		const wGlyphs = frame.rows(facing);
		const bGlyphs = body.rows(facing);
		let overlaps = 0;
		for (let ry = 0; ry < frame.h; ry++) {
			for (let rx = 0; rx < frame.w; rx++) {
				const wch = wGlyphs[ry][rx];
				if (wch === ' ') continue;
				const px = wx + rx;
				const py = wy + ry;
				// Is the body lit at this same screen cell?
				const bx = px - sx;
				const by = py - sy;
				const bch = bGlyphs[by]?.[bx];
				if (bch === undefined || bch === ' ') continue;
				overlaps++;
				expect(buf.at(px, py)?.ch).toBe(wch);
			}
		}
		expect(overlaps).toBeGreaterThan(0);
	}
});

test('a weaponless Avatar draws no weapon layer', () => {
	const buf = new FakeBuffer(24, 16);
	// Same body, but no equipped weapon (weapon undefined): the weapon layer is skipped.
	const e = makeEntity({ type: 'player', x: 10, y: 6, facing: 1 });
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const { sprite: body, ax: sx, ay: sy } = avatarTopLeft(e);
	const grip = body.grip;
	if (!grip) throw new Error('expected the body to declare a grip cell');
	// The sword's blade tip sits a row above the body top when equipped; with no weapon
	// that cell stays empty, proving the layer is gated on an equipped weapon.
	expect(buf.at(sx + grip.x, sy - 1)).toBeUndefined();
});

test('over terrain the pill is a cosmetic-colour wash and the handle sits on it (ADR 0016)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		name: 'neo',
		// hat present to prove it no longer affects the (now below-feet) chip position
		cosmetics: { hue: 0, hat: 3, nameplate: 4 },
	});

	renderZoneScene(
		buf,
		{ terrain: terrainUnderChip(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// Top-left corner: the bevel glyph is the wash (w4) blended in; its empty quadrant
	// (transparent bg) keeps the terrain base flattened underneath.
	expect(buf.at(left, boxTop)).toEqual({
		ch: '▟',
		fg: 'w4',
		bg: 'TR',
		blended: true,
	});
	// Pad cell: the whole cell is the cosmetic wash (w4), blended over the terrain base.
	expect(buf.at(left + 1, boxTop)).toEqual({
		ch: ' ',
		fg: 'w4',
		bg: 'w4',
		blended: true,
	});
	// Handle char is the chosen cosmetic colour (np4) at full opacity, on the wash backing.
	expect(buf.at(left + 2, boxTop)).toEqual({
		ch: 'n',
		fg: 'np4',
		bg: 'w4',
		blended: true,
	});
});

test('off terrain the pill is omitted and only the handle shows (ADR 0016)', () => {
	const buf = new FakeBuffer(20, 16);
	// flat20 is all-empty, so no chip cell is over solid ground.
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// The pill body (corner, pad, lip) is not drawn at all off terrain.
	expect(buf.at(left, boxTop)).toBeUndefined();
	expect(buf.at(left + 1, boxTop)).toBeUndefined();
	expect(buf.at(left, boxTop + 1)).toBeUndefined();
	// Only the handle glyph shows, floating on whatever is behind (transparent bg, the
	// default dim-grey ink since this entity has no cosmetics).
	expect(buf.at(left + 2, boxTop)).toEqual({
		ch: 'n',
		fg: 'NAME',
		bg: 'TR',
		blended: true,
	});
});

test('the nameplate position is independent of hat height', () => {
	const render = (hat: number) => {
		const buf = new FakeBuffer(20, 16);
		const e = makeEntity({
			type: 'player',
			x: 8,
			y: 7,
			name: 'a',
			cosmetics: { hue: 0, hat, nameplate: 0 },
		});
		renderZoneScene(
			buf,
			{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
			{ x: 0, y: 0 },
			STYLE,
		);
		return buf;
	};
	const boxTop = Math.round(7 + BOX.h);
	// Handle 'a' sits at column 2 of the chip (after the corner + pad); it's drawn on
	// the top row regardless of terrain, so it pins the chip's row directly.
	const left = Math.round(8 + BOX.w / 2 - ('a'.length + 4) / 2);
	// No hat vs the tallest hat (Wizard, 3 rows): the handle lands on the same row
	// either way, since the chip anchors below the feet now (#103).
	expect(render(0).at(left + 2, boxTop)?.ch).toBe('a');
	expect(render(3).at(left + 2, boxTop)?.ch).toBe('a');
});
