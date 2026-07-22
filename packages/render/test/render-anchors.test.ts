import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import type { Entity, EntityType } from '@mmo/core/entities';
import {
	type BodySprite,
	buildFormRegistry,
	type CellBuffer,
	drawEntitySprite,
	formFrame,
	type RenderStyle,
} from '../src';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
}

class FakeBuffer implements CellBuffer<string> {
	readonly width: number;
	readonly height: number;
	cells = new Map<string, Cell>();

	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
	}

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
		this.cells.set(`${x},${y}`, { ch, fg, bg });
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
	palette: { p: 'cP', a: 'cA', s: 'cS', w: 'cW' },
	paletteDefault: 'DEF',
	cosmetics: {
		hues: ['hue0', 'hue1'],
		nameplates: ['np0'],
		nameplateBgs: ['bg0'],
	},
};

function makeEntity(over: Partial<Entity> & { type: EntityType }): Entity {
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

const OVERRIDE_FORM = `{
	"anchors": { "grip": [2, 0], "head": [1, 0] },
	"animations": [
		{ "name": "idle" },
		{ "name": "walk", "anchors": { "1": { "grip": [0, 0] } } }
	]
}
--- idle
···
···
--- walk 0
···
···
--- walk 1
···
···
`;

function overrideBody() {
	const registry = buildFormRegistry([
		{ id: 'ovr', role: 'forms', text: OVERRIDE_FORM } satisfies SpriteSource,
	]);
	const body = registry.get('ovr');
	if (body === undefined) throw new Error('override form failed to compile');
	return body;
}

function resolvedGripX(
	body: BodySprite,
	animation: 'idle' | 'walk',
	frameIndex = 0,
) {
	const frame = formFrame(body, animation, frameIndex);
	return frame.anchors.grip?.x ?? body.grip.x;
}

test('a per-frame grip override wins over the doc grip; a plain animation inherits it (end-to-end from a .sprite source)', () => {
	const body = overrideBody();

	expect(resolvedGripX(body, 'idle')).toBe(2);

	expect(resolvedGripX(body, 'walk', 1)).toBe(0);
	expect(resolvedGripX(body, 'walk', 1)).toBe(resolvedGripX(body, 'idle') - 2);
});

test('drawEntitySprite seats a weapon layer for the default Form (the seat resolution runs end-to-end)', () => {
	const render = (weapon: number | undefined) => {
		const buf = new FakeBuffer(24, 16);
		const e = makeEntity({
			type: 'player',
			weapon,
			cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
		});
		drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
		return buf.cells.size;
	};

	expect(render(0)).toBeGreaterThan(render(undefined));
});
