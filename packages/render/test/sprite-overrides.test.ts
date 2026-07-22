import { expect, test } from 'bun:test';
import type { Entity, EntityType } from '@mmo/core/entities';
import {
	type BodySprite,
	type CellBuffer,
	drawEntitySprite,
	type RenderStyle,
	Sprite,
	type SpriteOverrides,
	type WeaponSprite,
} from '../src';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	blended?: boolean;
}

class FakeBuffer implements CellBuffer<string> {
	readonly width = 24;
	readonly height = 16;
	readonly cells = new Map<string, Cell>();
	clear(): void {
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
	palette: { p: 'body', h: 'hat', w: 'weapon', a: 'accent' },
	paletteDefault: 'default',
	cosmetics: {
		hues: ['hue'],
		nameplates: ['name'],
		nameplateBgs: ['name-bg'],
	},
};

function entity(over: Partial<Entity> & { type: EntityType }): Entity {
	return {
		id: 1,
		x: 8,
		y: 7,
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

const body: BodySprite = {
	frames: {
		idle: new Sprite('B', {
			defaultKey: 'p',
			anchors: { grip: { x: 0, y: 0 }, head: { x: 0, y: 0 } },
		}),
	},
	grip: { x: 0, y: 0 },
	head: { x: 0, y: 0 },
};

const hat = new Sprite('H', { defaultKey: 'h' });
const weapon: WeaponSprite = {
	frames: {
		rest: new Sprite('R', { defaultKey: 'w' }),
		swing: [
			new Sprite('W', { defaultKey: 'w' }),
			new Sprite('A', { defaultKey: 'w' }),
			new Sprite('C', { defaultKey: 'w' }),
		],
	},
	grip: { x: 0, y: 0 },
	accent: 'a',
};

function render(e: Entity, overrides: SpriteOverrides): FakeBuffer {
	const buf = new FakeBuffer();
	drawEntitySprite(
		buf,
		e,
		{ x: 0, y: 0 },
		STYLE,
		undefined,
		undefined,
		overrides,
	);
	return buf;
}

function glyphs(buf: FakeBuffer): string[] {
	return [...buf.cells.values()].map((cell) => cell.ch);
}

test('a base override replaces registry art for non-player entities', () => {
	const buf = render(entity({ type: 'chaser' }), {
		base: new Sprite('X', { defaultKey: 'p' }),
	});
	expect(glyphs(buf)).toEqual(['X']);
});

test('body overrides participate in cosmetic hue recoloring', () => {
	const buf = render(
		entity({
			type: 'player',
			cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'unknown' },
		}),
		{ body },
	);
	const bodyCell = [...buf.cells.values()].find((cell) => cell.ch === 'B');
	expect(bodyCell?.fg).toBe('hue');
});

test('explicit hat overrides compose with the body and null suppresses them', () => {
	const e = entity({
		type: 'player',
		cosmetics: { hue: 0, hat: 'unknown', nameplate: 0, form: 'unknown' },
	});
	expect(glyphs(render(e, { body, hat }))).toEqual(
		expect.arrayContaining(['B', 'H']),
	);
	expect(glyphs(render(e, { body, hat: null }))).toEqual(['B']);
});

test('weapon overrides select frames from the entity action phase', () => {
	const e = entity({
		type: 'player',
		weapon: 0,
		cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'unknown' },
		action: {
			move: 'basic',
			phase: 'recovery',
			progress: 0.5,
			flags: 0,
			emote: null,
			emoteT: 0,
		},
	});
	const buf = render(e, { body, weapon });
	expect(glyphs(buf)).toContain('C');
	expect(glyphs(buf)).not.toContain('R');
});
