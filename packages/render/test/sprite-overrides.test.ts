// The `SpriteOverrides` seam (ADR 0031): `drawEntitySprite` accepts optional
// work-in-progress art that replaces what the frozen id-keyed registries resolve.
// The forge Composited preview relies on this to render the live (unsaved) doc
// through the identical seat / mirror / recolor / swing-sample logic the game
// uses. These tests pin the two guarantees the seam exists for:
//   1. Passing an override that IS the registry's own art is pixel-identical to
//      passing no override (the game path is byte-for-byte unchanged).
//   2. Passing DIFFERENT art actually swaps the piece — and per-field presence is
//      deliberate: `{ weapon }` never strips the hat; `{ hat: null }` does.
import { expect, test } from 'bun:test';
import { BOX, type Entity, type EntityType } from '@mmo/core/entities';
import { parseTerrain } from '@mmo/core/physics';
import {
	type CellBuffer,
	drawEntitySprite,
	formById,
	hatById,
	type RenderStyle,
	type Sprite,
	spriteFor,
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

const groundUnder = (e: Entity) => {
	const surface = Math.round(e.y + BOX.h);
	return parseTerrain(
		Array.from({ length: 16 }, (_, r) => (r >= surface ? '#' : '.').repeat(24)),
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

function render(
	e: Entity,
	overrides?: Parameters<typeof drawEntitySprite>[6],
): string {
	const buf = new FakeBuffer(24, 16);
	drawEntitySprite(
		buf,
		e,
		{ x: 0, y: 0 },
		STYLE,
		groundUnder(e),
		undefined,
		overrides,
	);
	return dump(buf);
}

// --- 1. identity: override with the registry's own art == no override --------

test('override with identical body art is pixel-identical to no override', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		weapon: 0,
		cosmetics: { hue: 2, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	const base = render(e);
	// buddy is what formById('buddy') resolves — injecting it must not move a pixel.
	const injected = render(e, { body: formById('buddy') });
	expect(injected).toBe(base);
});

test('override with identical hat art is pixel-identical to no override', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	const base = render(e);
	const hat = hatById('wizard') as Sprite;
	expect(render(e, { hat })).toBe(base);
});

test('override with identical weapon art is pixel-identical to no override', () => {
	const e = makeEntity({ type: 'player', x: 8, y: 7, weapon: 0 });
	e.action = {
		move: 'basic',
		phase: 'active',
		progress: 0.5,
		flags: 0,
		emote: null,
		emoteT: 0,
	};
	const base = render(e);
	const weapon = weaponSpriteById(0);
	if (!weapon) throw new Error('expected default weapon art');
	expect(render(e, { weapon })).toBe(base);
});

test('override with identical monster base art is pixel-identical to no override', () => {
	const e = makeEntity({ type: 'chaser', x: 8, y: 6 });
	const base = render(e);
	expect(render(e, { base: spriteFor('chaser') })).toBe(base);
});

// --- 2. replacement: different art actually swaps the piece ------------------

test('a hat override replaces the registry hat', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	const wizard = render(e);
	const other = hatById('crown') ?? hatById('cap');
	if (!other) throw new Error('expected a second registered hat');
	const swapped = render(e, { hat: other });
	expect(swapped).not.toBe(wizard);
});

test('hat: null draws no hat; hat absent keeps the registry hat', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	const withHat = render(e);
	const noHat = render(e, { hat: null });
	expect(noHat).not.toBe(withHat);
	// Same entity with the hat stripped by cosmetics — the null override must match.
	const stripped = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
	});
	expect(noHat).toBe(render(stripped));
});

test('an overrides object with only weapon set does not strip the hat', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		weapon: 0,
		cosmetics: { hue: 0, hat: 'wizard', nameplate: 0, form: 'buddy' },
	});
	const full = render(e);
	const weapon = weaponSpriteById(0);
	if (!weapon) throw new Error('expected default weapon art');
	// Presence-based: `hat` is absent, so it falls back to the registry hat.
	expect(render(e, { weapon })).toBe(full);
});

test('a body override replaces the registry form', () => {
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
	});
	const buddy = render(e);
	// A degenerate 1-cell body: whatever it is, it must differ from buddy.
	const tiny = formById('buddy');
	const swapped = render(e, {
		body: { ...tiny, frames: { idle: hatById('wizard') as Sprite } },
	});
	expect(swapped).not.toBe(buddy);
});
