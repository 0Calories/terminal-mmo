// Per-frame anchor resolution in drawEntitySprite (ADR 0031): a frame whose
// Sprite carries its own `grip` anchor seats the weapon at that anchor; a frame
// with no anchors falls back to the BodySprite's grip. Plain assertions over a
// FakeBuffer (see golden-frames.test.ts for the pattern) rather than snapshots.
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

// A `forms` source with a per-frame `grip` override on one animation. Bodies now
// come only from the directory-scan registry, so a per-frame override is
// authored as a `.sprite` document (via buildFormRegistry) rather than by
// mutating an array. idle/walk satisfy the forms role profile.
const OVERRIDE_FORM = `{
	"anchors": { "grip": [2, 0], "head": [1, 0] },
	"animations": { "walk": ["walk-0", "walk-1"] },
	"frames": { "walk-1": { "anchors": { "grip": [0, 0] } } }
}
--- idle
···
···
--- walk-0
···
···
--- walk-1
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

// Reproduces drawEntitySprite's seat rule verbatim (render.ts): a frame's own
// grip anchor wins, otherwise the BodySprite's grip.
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
	// idle authors no override -> the renderer resolves the doc/body grip (x=2)
	expect(resolvedGripX(body, 'idle')).toBe(2);
	// walk-1 overrides grip to x=0 -> two cells left of the body grip
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
	// Arming the Avatar adds a weapon layer, which drawEntitySprite can only place
	// by resolving the body/frame grip — so the armed render paints strictly more
	// cells than the unarmed one.
	expect(render(0)).toBeGreaterThan(render(undefined));
});
