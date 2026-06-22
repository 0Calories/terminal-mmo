import { expect, test } from 'bun:test';
import { BOX } from '../src/constants';
import {
	type CellBuffer,
	type RenderStyle,
	renderZoneScene,
} from '../src/render';
import { type Sprite, spriteFor, spriteForNpc } from '../src/sprites';
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

test('a named entity gets a nameplate one row above its sprite', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = spriteFor('player');
	const top = Math.round(e.y + BOX.h - sprite.h);
	const cx = e.x + BOX.w / 2;
	const x = Math.round(cx - 'neo'.length / 2);
	expect(buf.at(x, top - 1)?.ch).toBe('n');
	expect(buf.at(x + 1, top - 1)).toEqual({ ch: 'e', fg: 'NAME', bg: 'TR' });
	expect(buf.at(x + 2, top - 1)?.ch).toBe('o');
});
