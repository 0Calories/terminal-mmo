import { expect, test } from 'bun:test';
import {
	BOX,
	DEFAULT_FORM_ID,
	type Entity,
	type EntityType,
} from '@mmo/core/entities';
import { parseTerrain } from '@mmo/core/physics';
import { spriteMetaFor } from '@mmo/core/sprites';
import {
	type CellBuffer,
	drawEntitySprite,
	drawNameplates,
	formById,
	type RenderStyle,
	renderZoneScene,
	Sprite,
} from '../src';
import { blitSprite } from '../src/render';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	blended?: boolean;
}

class FakeBuffer implements CellBuffer<string> {
	readonly cells = new Map<string, Cell>();
	cleared: string | null = null;
	constructor(
		readonly width: number,
		readonly height: number,
	) {}
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

const STYLE: RenderStyle<string> = {
	bg: 'BG',
	terrainFg: 'TFG',
	terrainBg: 'TBG',
	portal: 'PORTAL',
	transparent: 'TR',
	hurt: 'HURT',
	nameplate: 'NAME',
	nameplateBg: 'NAMEBG',
	palette: { p: 'cP', s: 'cS', k: 'cK' },
	paletteDefault: 'DEF',
	cosmetics: {
		hues: ['hue0'],
		nameplates: ['np0', 'np1'],
		nameplateBgs: ['bg0', 'bg1'],
	},
};

function entity(over: Partial<Entity> & { type: EntityType }): Entity {
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

const emptyTerrain = () =>
	parseTerrain(Array.from({ length: 16 }, () => '.'.repeat(20)));

test('terrain renders exposed and interior solid cells with their distinct fills', () => {
	const terrain = parseTerrain(['......', '...#..', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);
	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(buf.cleared).toBe('BG');
	expect(buf.at(3, 1)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' });
	expect(buf.at(3, 2)).toEqual({ ch: '█', fg: 'TFG', bg: 'TBG' });
	expect(buf.at(0, 0)).toBeUndefined();
});

test('terrain coordinates are translated by the camera', () => {
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);
	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 2, y: 1 },
		STYLE,
	);
	expect(buf.at(1, 1)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' });
	expect(buf.at(3, 2)).toBeUndefined();
});

test('portals fill their world-space box with translucent cells', () => {
	const buf = new FakeBuffer(6, 4);
	renderZoneScene(
		buf,
		{
			terrain: parseTerrain(['......', '......', '......', '......']),
			portals: [
				{
					x: 1,
					y: 1,
					w: 2,
					h: 2,
					target: 'elsewhere',
					arrival: { x: 0, y: 0 },
				},
			],
			npcs: [],
			entities: [],
		},
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(
		[...buf.cells.values()].filter((cell) => cell.ch === '▒'),
	).toHaveLength(4);
	for (const cell of buf.cells.values())
		expect(cell).toEqual({
			ch: '▒',
			fg: 'PORTAL',
			bg: 'TR',
			blended: true,
		});
});

test('entity art is centered on its collision box and aligned by baseline', () => {
	const buf = new FakeBuffer(20, 16);
	const e = entity({ type: 'chaser', x: 8, y: 6 });
	const sprite = new Sprite('AB\nCD', { defaultKey: 'p' });
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE, undefined, undefined, {
		base: sprite,
	});
	const left = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const top = Math.round(
		e.y + BOX.h - sprite.h + spriteMetaFor(e.type).baseline,
	);
	expect(buf.at(left, top)?.ch).toBe('A');
	expect(buf.at(left + 1, top)?.ch).toBe('B');
	expect(buf.at(left, top + 1)?.ch).toBe('C');
	expect(buf.at(left + 1, top + 1)?.ch).toBe('D');
});

test('hurt and ghost presentation transform synthetic art without changing glyphs', () => {
	const sprite = new Sprite('A·', { defaultKey: 'p' });
	const hurt = new FakeBuffer(20, 16);
	const e = entity({ type: 'chaser', x: 8, y: 6, hurtT: 0.5 });
	drawEntitySprite(hurt, e, { x: 0, y: 0 }, STYLE, undefined, undefined, {
		base: sprite,
	});
	expect([...hurt.cells.values()].find((cell) => cell.ch === 'A')?.fg).toBe(
		'HURT',
	);

	const ghost = new FakeBuffer(20, 16);
	drawEntitySprite(
		ghost,
		{ ...e, hurtT: 0 },
		{ x: 0, y: 0 },
		STYLE,
		undefined,
		{ bg: 'TINT', fade: (fg) => `F(${fg})` },
		{ base: sprite },
	);
	expect(
		[...ghost.cells.values()].find((cell) => cell.ch === 'A'),
	).toMatchObject({
		fg: 'F(cP)',
		bg: 'TINT',
	});
	expect(
		[...ghost.cells.values()].find((cell) => cell.ch === ' '),
	).toMatchObject({
		bg: 'TINT',
	});
});

const defaultBaseline = formById(DEFAULT_FORM_ID).baseline ?? 0;
const handleRow = (e: Entity) => Math.round(e.y + BOX.h + defaultBaseline);
const handleLeft = (e: Entity) =>
	Math.round(e.x + BOX.w / 2 - (e.name?.length ?? 0) / 2);

test('nameplates draw centered text below the avatar baseline', () => {
	const buf = new FakeBuffer(20, 16);
	const e = entity({ type: 'player', x: 8, y: 7, name: 'neo' });
	drawNameplates(buf, [e], { x: 0, y: 0 }, emptyTerrain(), STYLE);
	const row = handleRow(e);
	const left = handleLeft(e);
	expect(
		[0, 1, 2].map((offset) => buf.at(left + offset, row)?.ch).join(''),
	).toBe('neo');
	expect(buf.at(left - 1, row)).toBeUndefined();
	expect(buf.at(left + 3, row)).toBeUndefined();
});

test('nameplate colors follow cosmetics and their position ignores hat choice', () => {
	const render = (hat: string) => {
		const buf = new FakeBuffer(20, 16);
		const e = entity({
			type: 'player',
			x: 8,
			y: 7,
			name: 'x',
			cosmetics: {
				hue: 0,
				hat,
				nameplate: 1,
				form: DEFAULT_FORM_ID,
			},
		});
		drawNameplates(buf, [e], { x: 0, y: 0 }, emptyTerrain(), STYLE);
		return buf.at(handleLeft(e), handleRow(e));
	};
	expect(render('')).toEqual({ ch: 'x', fg: 'np1', bg: 'bg1' });
	expect(render('arbitrary-hat')).toEqual(render(''));
});

test('nameplates use fallback colors, skip unnamed entities, and remain a caller layer', () => {
	const unnamed = entity({ type: 'player', x: 8, y: 7 });
	const named = { ...unnamed, name: 'x' };
	const direct = new FakeBuffer(20, 16);
	drawNameplates(
		direct,
		[unnamed, named],
		{ x: 0, y: 0 },
		emptyTerrain(),
		STYLE,
	);
	expect(direct.cells.size).toBe(1);
	expect(direct.at(handleLeft(named), handleRow(named))).toEqual({
		ch: 'x',
		fg: 'NAME',
		bg: 'NAMEBG',
	});

	const scene = new FakeBuffer(20, 16);
	renderZoneScene(
		scene,
		{ terrain: emptyTerrain(), portals: [], npcs: [], entities: [named] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(scene.at(handleLeft(named), handleRow(named))?.ch).not.toBe('x');
});

const twoTone = new Sprite('▀█', { defaultKey: 'p', colors: 'ps', bg: 'k·' });

test('authored and transparent background channels use opaque and blended writes', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE);
	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TR', blended: true });
});

test('hurt and recolor resolve foreground and background channels independently', () => {
	const hurt = new FakeBuffer(4, 4);
	blitSprite(hurt, twoTone, 0, 0, 1, true, STYLE);
	expect(hurt.at(0, 0)).toEqual({ ch: '▀', fg: 'HURT', bg: 'HURT' });
	expect(hurt.at(1, 0)).toMatchObject({ fg: 'HURT', bg: 'TR', blended: true });

	const recolored = new FakeBuffer(4, 4);
	blitSprite(recolored, twoTone, 0, 0, 1, false, STYLE, {
		p: 'HUE',
		k: 'KREC',
	});
	expect(recolored.at(0, 0)).toMatchObject({ fg: 'HUE', bg: 'KREC' });
});

test('ghost rendering fades both authored channels and uses the tint for transparency', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE, undefined, {
		bg: 'TINT',
		fade: (fg) => `F(${fg})`,
	});
	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'F(cP)', bg: 'F(cK)' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'F(cS)', bg: 'TINT' });
});

test('planting preserves authored backgrounds and applies terrain only over solid cells', () => {
	const buf = new FakeBuffer(4, 4);
	const terrain = parseTerrain(['##', '..']);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE, undefined, undefined, {
		terrain,
		camX: 0,
		camY: 0,
	});
	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TFG' });

	const edge = new FakeBuffer(4, 4);
	blitSprite(
		edge,
		new Sprite('XX', { defaultKey: 'p' }),
		0,
		0,
		1,
		false,
		STYLE,
		undefined,
		undefined,
		{ terrain: parseTerrain(['#.']), camX: 0, camY: 0 },
	);
	expect(edge.at(0, 0)).toMatchObject({ bg: 'TFG' });
	expect(edge.at(1, 0)).toMatchObject({ bg: 'TR', blended: true });
});

test('mirroring keeps color and background channels attached to their glyph cells', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, -1, false, STYLE);
	expect(buf.at(1, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(0, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TR', blended: true });
});
