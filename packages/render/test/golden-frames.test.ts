// Golden-frame regression tests: pin the exact rendered output of every
// existing TypeScript-authored sprite in @mmo/render. A later change adds a
// second (bg) color channel to `Sprite` and the blit path; these snapshots
// prove existing art renders pixel-identically after that change.
//
// Tests against CURRENT behaviour only — do not modify any source file.
import { expect, test } from 'bun:test';
import {
	BOX,
	type Entity,
	type EntityType,
	parseTerrain,
	STRIDE,
} from '@mmo/core';
import {
	type CellBuffer,
	drawEntitySprite,
	formById,
	HAT_IDS,
	hatById,
	type RenderStyle,
	renderZoneScene,
	type Sprite,
	spriteFor,
	spriteForNpc,
	weaponSpriteById,
} from '../src';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	blended?: boolean;
}

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
		hues: ['hue0', 'hue1', 'hue2', 'hue3', 'hue4', 'hue5', 'hue6', 'hue7'],
		nameplates: ['np0', 'np1', 'np2', 'np3', 'np4', 'np5', 'np6', 'np7'],
		nameplateBgs: ['bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6', 'bg7'],
	},
};

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

const groundUnder = (e: Entity) => {
	const surface = Math.round(e.y + BOX.h);
	return parseTerrain(
		Array.from({ length: 16 }, (_, r) => (r >= surface ? '#' : '.').repeat(20)),
	);
};

function dump(buf: FakeBuffer): string {
	const rows: string[] = [];
	for (let y = 0; y < buf.height; y++) {
		const cells: string[] = [];
		for (let x = 0; x < buf.width; x++) {
			const c = buf.at(x, y);
			cells.push(c ? `${c.ch}|${c.fg}|${c.bg}${c.blended ? '*' : ''}` : '_');
		}
		rows.push(cells.join(' '));
	}
	return rows.join('\n');
}

// --- 1. Raw grid goldens -----------------------------------------------

interface SpriteGrid {
	w: number;
	h: number;
	baseline: number;
	right: readonly string[];
	left: readonly string[];
	keysRight: readonly string[];
	keysLeft: readonly string[];
}

function spriteGrid(sprite: {
	w: number;
	h: number;
	baseline: number;
	rows(facing: 1 | -1): readonly string[];
	colorKeys(facing: 1 | -1): readonly string[];
}): SpriteGrid {
	return {
		w: sprite.w,
		h: sprite.h,
		baseline: sprite.baseline,
		right: sprite.rows(1),
		left: sprite.rows(-1),
		keysRight: sprite.colorKeys(1),
		keysLeft: sprite.colorKeys(-1),
	};
}

test('golden: monster sprites', () => {
	expect(spriteGrid(spriteFor('player'))).toMatchSnapshot('player');
	expect(spriteGrid(spriteFor('chaser'))).toMatchSnapshot('chaser');
	expect(spriteGrid(spriteFor('shooter'))).toMatchSnapshot('shooter');
	expect(spriteGrid(spriteFor('brute'))).toMatchSnapshot('brute');
});

test('golden: npc sprites', () => {
	expect(spriteGrid(spriteForNpc('vendor'))).toMatchSnapshot('vendor');
});

test('golden: hat sprites', () => {
	for (const id of HAT_IDS) {
		const hat = hatById(id);
		if (hat === null) continue;
		expect(spriteGrid(hat)).toMatchSnapshot(`hat: ${id}`);
	}
});

// buddy is now compiled from sprites/forms/buddy.sprite (ADR 0031) rather than
// hand-authored TS. These snapshots pin that the compiled frames are pixel-for-
// pixel identical to the pre-migration art.
test('golden: buddy form frames', () => {
	for (const [poseId, frame] of Object.entries(formById('buddy').frames)) {
		const isArr = Array.isArray(frame);
		const frames: readonly Sprite[] = isArr ? frame : [frame as Sprite];
		frames.forEach((f, i) => {
			const label = isArr ? `buddy: ${poseId}[${i}]` : `buddy: ${poseId}`;
			expect(spriteGrid(f)).toMatchSnapshot(label);
		});
	}
});

test('golden: sword weapon frames', () => {
	const weapon = weaponSpriteById(0);
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	if (weapon.frames.idle)
		expect(spriteGrid(weapon.frames.idle)).toMatchSnapshot('sword: idle');
	if (weapon.frames.windup)
		expect(spriteGrid(weapon.frames.windup)).toMatchSnapshot('sword: windup');
	if (weapon.frames.active) {
		weapon.frames.active.forEach((f, i) => {
			if (f === undefined) return;
			expect(spriteGrid(f)).toMatchSnapshot(`sword: active[${i}]`);
		});
	}
	if (weapon.frames.recovery)
		expect(spriteGrid(weapon.frames.recovery)).toMatchSnapshot(
			'sword: recovery',
		);
});

// --- 2. Composited scene goldens ----------------------------------------

test('golden scene: full avatar facing right', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		facing: 1,
		weapon: 0,
		cosmetics: { hue: 2, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	renderZoneScene(
		buf,
		{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(dump(buf)).toMatchSnapshot('avatar facing right');
});

test('golden scene: full avatar facing left', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		facing: -1,
		weapon: 0,
		cosmetics: { hue: 2, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	renderZoneScene(
		buf,
		{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(dump(buf)).toMatchSnapshot('avatar facing left');
});

test('golden scene: hurt chaser', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({ type: 'chaser', x: 8, y: 6, hurtT: 0.5 });
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(dump(buf)).toMatchSnapshot('hurt chaser');
});

test('golden scene: ghost shooter', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({ type: 'shooter', x: 6, y: 6 });
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE, undefined, {
		bg: 'TINT',
		fade: (fg) => `F(${fg})`,
	});
	expect(dump(buf)).toMatchSnapshot('ghost shooter');
});

test('golden scene: walk frames', () => {
	for (const [x, label] of [
		[2 * STRIDE + 3, 'walkA'],
		[3 * STRIDE + 3, 'walkB'],
	] as const) {
		const buf = new FakeBuffer(40, 16);
		const e = makeEntity({ type: 'player', x, y: 7, vx: 3 });
		drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
		expect(dump(buf)).toMatchSnapshot(`walk frame: ${label}`);
	}
});

test('golden scene: mid-swing', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = {
		move: 'basic',
		phase: 'active',
		progress: 0.5,
		flags: 0,
		emote: null,
		emoteT: 0,
	};
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(dump(buf)).toMatchSnapshot('mid-swing');
});
