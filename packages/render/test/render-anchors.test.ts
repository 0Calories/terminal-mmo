// Per-frame anchor resolution in drawEntitySprite (ADR 0031): a frame whose
// Sprite carries its own `grip` anchor seats the weapon at that anchor; a frame
// with no anchors falls back to the BodySprite's grip. Plain assertions over a
// FakeBuffer (see golden-frames.test.ts for the pattern) rather than snapshots.
import { expect, test } from 'bun:test';
import type { Entity, EntityType } from '@mmo/core';
import {
	type BodySprite,
	type CellBuffer,
	drawEntitySprite,
	FORMS,
	type RenderStyle,
	Sprite,
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

function leftmostX(buf: FakeBuffer): number {
	let min = Number.POSITIVE_INFINITY;
	for (const key of buf.cells.keys()) {
		const x = Number(key.split(',')[0]);
		if (x < min) min = x;
	}
	return min;
}

// Fully transparent body so the only cells drawn are the weapon's — makes the
// weapon seat position directly observable.
function transparentBody(anchors?: Record<string, { x: number; y: number }>) {
	const idle = new Sprite('···\n···', {
		defaultKey: 'p',
		...(anchors ? { anchors } : {}),
	});
	const body: BodySprite = {
		frames: { idle },
		grip: { x: 2, y: 0 },
		head: { x: 1, y: 0 },
	};
	return body;
}

function renderWithBody(body: BodySprite): FakeBuffer {
	const forms = FORMS as BodySprite[];
	forms.push(body);
	const idx = forms.length - 1;
	try {
		const buf = new FakeBuffer(24, 16);
		const e = makeEntity({
			type: 'player',
			weapon: 0,
			// `form` is mid-migration to a string id in @mmo/core; formById still
			// accepts a numeric index at runtime, which is how we reach an
			// injected test body. Cast past the in-flight string type.
			cosmetics: {
				hue: 0,
				hat: '',
				nameplate: 0,
				form: idx as unknown as string,
			} as Entity['cosmetics'],
		});
		drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
		return buf;
	} finally {
		forms.pop();
	}
}

test('frame with no anchors seats weapon at body grip; a frame grip override shifts it', () => {
	// plain frame -> render resolves grip from body.grip (x=2)
	const plain = renderWithBody(transparentBody());
	// overriding frame -> grip anchor x=0, two cells to the left of body grip
	const shifted = renderWithBody(transparentBody({ grip: { x: 0, y: 0 } }));

	const plainLeft = leftmostX(plain);
	const shiftedLeft = leftmostX(shifted);

	expect(Number.isFinite(plainLeft)).toBe(true);
	expect(Number.isFinite(shiftedLeft)).toBe(true);
	// body.grip.x (2) - override grip.x (0) = 2 cells left
	expect(shiftedLeft).toBe(plainLeft - 2);
});
