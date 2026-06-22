import { expect, test } from 'bun:test';
import { BOX } from '../src/constants';
import {
	type CellBuffer,
	drawEntitySprite,
	type RenderStyle,
	renderZoneScene,
} from '../src/render';
import {
	ghostGlyph,
	HATS,
	type Sprite,
	spriteFor,
	spriteForNpc,
} from '../src/sprites';
import { parseTerrain } from '../src/terrain';
import type { Entity, EntityType, Facing } from '../src/types';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
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
		this.setCell(x, y, ch, fg, bg);
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
	nameplateBg: 'NAMEBG',
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
		expect(buf.at(x, y)).toEqual({ ch: '▒', fg: 'PORTAL', bg: 'TR' });
	}
});

test('ghost mode maps each glyph to its ghost form, over the tint, colours kept (#118)', () => {
	const buf = new FakeBuffer(20, 16);
	// The shooter sprite has both solid full blocks (█→░) and partial puzzle-shape
	// blocks (kept), so it exercises the per-glyph mapping in one blit.
	const e = makeEntity({ type: 'shooter', x: 6, y: 6 });
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE, { bg: 'TINT' });

	const sprite = spriteFor('shooter');
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const sy = Math.round(e.y + BOX.h - sprite.h);
	const glyphs = sprite.rows(1);
	const keys = sprite.colorKeys(1);
	let sawFade = false;
	let sawKept = false;
	for (let ry = 0; ry < sprite.h; ry++) {
		for (let rx = 0; rx < sprite.w; rx++) {
			const ch = glyphs[ry][rx];
			if (ch === ' ') continue;
			const cell = buf.at(sx + rx, sy + ry);
			expect(cell?.ch).toBe(ghostGlyph(ch)); // mapped to its ghost form
			expect(cell?.bg).toBe('TINT'); // opaque placement-state tint behind it
			expect(cell?.fg).toBe(fgFor(keys[ry][rx])); // real sprite colour preserved
			if (ch === '█')
				sawFade = true; // a solid block...
			else sawKept = true; // ...and a partial block both appear
		}
	}
	expect(ghostGlyph('█')).toBe('░'); // full block fades to a light shade
	expect(ghostGlyph('▟')).toBe('▟'); // partial puzzle-shape block keeps its shape
	expect(sawFade && sawKept).toBe(true);
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

test('a named entity gets a boxed nameplate below its sprite', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	// The box top border sits on the row directly below the feet (one past the
	// Sprite's last row), centred over the box; its width is the handle + 2 borders.
	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 2) / 2);
	// Top border: ╭──╮
	expect(buf.at(left, boxTop)?.ch).toBe('╭');
	expect(buf.at(left + 1, boxTop)?.ch).toBe('─');
	expect(buf.at(left + 4, boxTop)?.ch).toBe('╮');
	// Handle row: │neo│
	expect(buf.at(left, boxTop + 1)?.ch).toBe('│');
	expect(buf.at(left + 1, boxTop + 1)?.ch).toBe('n');
	expect(buf.at(left + 2, boxTop + 1)?.ch).toBe('e');
	expect(buf.at(left + 3, boxTop + 1)?.ch).toBe('o');
	expect(buf.at(left + 4, boxTop + 1)?.ch).toBe('│');
	// Bottom border: ╰──╯
	expect(buf.at(left, boxTop + 2)?.ch).toBe('╰');
	expect(buf.at(left + 4, boxTop + 2)?.ch).toBe('╯');
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

test('the boxed nameplate uses the chosen colour with an opaque fill', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		name: 'neo',
		// hat present to prove it no longer affects the (now below-feet) plate position
		cosmetics: { hue: 0, hat: 3, nameplate: 4 },
	});

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 2) / 2);
	// Border tinted with the chosen nameplate colour (np4), opaque fill behind it.
	expect(buf.at(left, boxTop)).toEqual({ ch: '╭', fg: 'np4', bg: 'NAMEBG' });
	// Handle char tinted the same, on the opaque fill.
	expect(buf.at(left + 1, boxTop + 1)).toEqual({
		ch: 'n',
		fg: 'np4',
		bg: 'NAMEBG',
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
	const left = Math.round(8 + BOX.w / 2 - 3 / 2);
	// No hat vs the tallest hat (Wizard, 3 rows): the plate's top border lands on the
	// same row either way, since it anchors below the feet now (#103).
	expect(render(0).at(left, boxTop)?.ch).toBe('╭');
	expect(render(3).at(left, boxTop)?.ch).toBe('╭');
});
