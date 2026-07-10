import { expect, test } from 'bun:test';
import {
	BOX,
	bladeEdgeArc,
	type Entity,
	type EntityType,
	type Facing,
	meleeHitbox,
	parseTerrain,
	STRIDE,
	sweepIndex,
} from '@mmo/core';
import {
	type CellBuffer,
	drawEntitySprite,
	drawNameplates,
	FORMS,
	formById,
	formFrame,
	hatById,
	type RenderStyle,
	renderZoneScene,
	Sprite,
	spriteFor,
	spriteForNpc,
	WEAPON_ACCENT_KEY,
	weaponSpriteById,
} from '../src';
import { blitSprite } from '../src/render';

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

function expectSpriteAt(
	buf: FakeBuffer,
	sprite: Sprite,
	ax: number,
	ay: number,
	facing: Facing,
	expectedFg: (key: string) => string,
	skip?: (px: number, py: number) => boolean,
) {
	const glyphs = sprite.rows(facing);
	const keys = sprite.colorKeys(facing);
	for (let ry = 0; ry < sprite.h; ry++) {
		for (let rx = 0; rx < sprite.w; rx++) {
			const ch = glyphs[ry][rx];
			if (ch === ' ') continue;
			if (skip?.(ax + rx, ay + ry)) continue;
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
		hues: ['hue0', 'hue1', 'hue2', 'hue3', 'hue4', 'hue5', 'hue6', 'hue7'],
		nameplates: ['np0', 'np1', 'np2', 'np3', 'np4', 'np5', 'np6', 'np7'],
		nameplateBgs: ['bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6', 'bg7'],
	},
};

const fgFor = (key: string) => STYLE.palette[key] ?? STYLE.paletteDefault;

const accentFg = (accent: string) =>
	STYLE.palette[accent] ?? STYLE.paletteDefault;

const weaponFgFor = (accent: string) => (key: string) =>
	key === WEAPON_ACCENT_KEY ? accentFg(accent) : fgFor(key);

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

test('terrain: a solid cell renders as a block; empty cells stay cleared', () => {
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.cleared).toBe('BG');
	// Lower-half block, so its bg is the sky BG, not terrainBg.
	expect(buf.at(3, 2)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' });
	expect(buf.at(0, 0)).toBeUndefined();
});

test('the terrain top surface lowers to ▄; interior cells stay █ (ADR 0021)', () => {
	const terrain = parseTerrain(['......', '...#..', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.at(3, 1)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' });
	expect(buf.at(3, 2)).toEqual({ ch: '█', fg: 'TFG', bg: 'TBG' });
});

test('terrain scrolls with the camera', () => {
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
	const e = makeEntity({ type: 'shooter', x: 6, y: 6 });
	const fade = (fg: string) => `FADED(${fg})`;
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE, undefined, {
		bg: 'TINT',
		fade,
	});

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
			expect(cell?.bg).toBe('TINT');
			if (ch === ' ') {
				expect(cell?.ch).toBe(' ');
				sawFilledGap = true;
				continue;
			}
			expect(cell?.ch).toBe(ch);
			expect(cell?.fg).toBe(fade(fgFor(keys[ry][rx])));
			if (ch === '█') sawSolid = true;
			else sawPartial = true;
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
	const back = makeEntity({ id: 1, type: 'chaser', x: 8, y: 5 });
	const front = makeEntity({ id: 2, type: 'player', x: 8, y: 6 });

	renderZoneScene(
		buf,
		// Passed out of order to prove the renderer sorts.
		{ terrain: flat20(), portals: [], npcs: [], entities: [front, back] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = formFrame(FORMS[0], 'idle');
	const ax = Math.round(front.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(front.y + BOX.h - sprite.h + (FORMS[0].baseline ?? 0));
	const glyphs = sprite.rows(1);
	for (let rx = 0; rx < sprite.w; rx++) {
		const ch = glyphs[0][rx];
		if (ch === ' ') continue;
		expect(buf.at(ax + rx, ay)?.ch).toBe(ch);
	}
});

const handleRow = (e: Entity) =>
	Math.round(e.y + BOX.h + (FORMS[0].baseline ?? 0));
const handleLeft = (e: Entity) =>
	Math.round(e.x + BOX.w / 2 - (e.name?.length ?? 0) / 2);

test('drawNameplates draws the Handle one row below the planted feet', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	drawNameplates(buf, [e], { x: 0, y: 0 }, flat20(), STYLE);

	const row = handleRow(e);
	const left = handleLeft(e);
	expect(row).toBe(Math.round(e.y + BOX.h + 1));
	expect(buf.at(left, row)?.ch).toBe('n');
	expect(buf.at(left + 1, row)?.ch).toBe('e');
	expect(buf.at(left + 2, row)?.ch).toBe('o');
	expect(buf.at(left, row + 1)).toBeUndefined();
	expect(buf.at(left - 1, row)).toBeUndefined();
	expect(buf.at(left + 3, row)).toBeUndefined();
});

test('the Handle position is independent of hat height', () => {
	const render = (hat: string) => {
		const buf = new FakeBuffer(20, 16);
		const e = makeEntity({
			type: 'player',
			x: 8,
			y: 7,
			name: 'a',
			cosmetics: { hue: 0, hat, nameplate: 0, form: 'buddy' },
		});
		drawNameplates(buf, [e], { x: 0, y: 0 }, flat20(), STYLE);
		return buf;
	};
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'a' });
	const row = handleRow(e);
	const left = handleLeft(e);
	expect(render('').at(left, row)?.ch).toBe('a');
	expect(render('wizard').at(left, row)?.ch).toBe('a');
});

test('each Handle letter is the cosmetic ink on a darkened same-hue backing', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		name: 'neo',
		cosmetics: { hue: 0, hat: 'wizard', nameplate: 4, form: 'buddy' },
	});

	drawNameplates(buf, [e], { x: 0, y: 0 }, flat20(), STYLE);

	const row = handleRow(e);
	const left = handleLeft(e);
	expect(buf.at(left, row)).toEqual({ ch: 'n', fg: 'np4', bg: 'bg4' });
	expect(buf.at(left + 1, row)).toEqual({ ch: 'e', fg: 'np4', bg: 'bg4' });
	expect(buf.at(left + 2, row)).toEqual({ ch: 'o', fg: 'np4', bg: 'bg4' });
});

test('a Handle with no cosmetics uses the default ink and backing', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'x' });

	drawNameplates(buf, [e], { x: 0, y: 0 }, flat20(), STYLE);

	expect(buf.at(handleLeft(e), handleRow(e))).toEqual({
		ch: 'x',
		fg: 'NAME',
		bg: 'NAMEBG',
	});
});

test('the Handle backing is unconditional — same over terrain, sprite, or sky', () => {
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'n' });
	const row = handleRow(e);
	const left = handleLeft(e);
	const overSky = new FakeBuffer(20, 16);
	drawNameplates(overSky, [e], { x: 0, y: 0 }, flat20(), STYLE);
	const overGround = new FakeBuffer(20, 16);
	const ground = parseTerrain(
		Array.from({ length: 16 }, (_, r) => (r === row ? '#' : '.').repeat(20)),
	);
	drawNameplates(overGround, [e], { x: 0, y: 0 }, ground, STYLE);
	const expected = { ch: 'n', fg: 'NAME', bg: 'NAMEBG' };
	expect(overSky.at(left, row)).toEqual(expected);
	expect(overGround.at(left, row)).toEqual(expected);
});

test('an entity with no Handle draws nothing', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7 });

	drawNameplates(buf, [e], { x: 0, y: 0 }, flat20(), STYLE);

	expect(buf.cells.size).toBe(0);
});

test('renderZoneScene alone draws no nameplate cells (names are a caller layer)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const row = handleRow(e);
	const left = handleLeft(e);
	expect(buf.at(left, row)?.ch).not.toBe('n');
	expect(buf.at(left + 1, row)?.ch).not.toBe('e');
	expect(buf.at(left + 2, row)?.ch).not.toBe('o');
});

function avatarTopLeft(e: Entity) {
	const form = formById(e.cosmetics?.form);
	const sprite = formFrame(form, 'idle');
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h + (form.baseline ?? 0));
	return { sprite, ax, ay, grip: form.grip, head: form.head };
}

test("an Avatar renders its Form's idle Pose as its body, through the bodyFrame selector (ADR 0020)", () => {
	const buf = new FakeBuffer(20, 16);
	for (const facing of [1, -1] as Facing[]) {
		buf.clear('BG');
		const e = makeEntity({ type: 'player', x: 8, y: 7, facing });
		renderZoneScene(
			buf,
			{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
			{ x: 0, y: 0 },
			STYLE,
		);
		const { sprite, ax, ay } = avatarTopLeft(e);
		expect(sprite).toBe(formFrame(FORMS[0], 'idle'));
		expectSpriteAt(buf, sprite, ax, ay, facing, fgFor);
	}
});

test('each Avatar Form renders its own idle body through the shared render path (ADR 0020)', () => {
	for (let form = 0; form < FORMS.length; form++) {
		for (const facing of [1, -1] as Facing[]) {
			const buf = new FakeBuffer(20, 16);
			buf.clear('BG');
			const e = makeEntity({
				type: 'player',
				x: 8,
				y: 7,
				facing,
				// This loop deliberately drives the numeric form index (see FORMS[form]
				// below); formById still accepts it. Cast past the in-flight string type.
				cosmetics: {
					hue: 0,
					hat: '',
					nameplate: 0,
					form: form as unknown as string,
				},
			});
			renderZoneScene(
				buf,
				{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
				{ x: 0, y: 0 },
				STYLE,
			);
			const { sprite, ax, ay } = avatarTopLeft(e);
			expect(sprite).toBe(formFrame(FORMS[form], 'idle'));
			expectSpriteAt(buf, sprite, ax, ay, facing, (key) =>
				key === 'p' ? 'hue0' : fgFor(key),
			);
		}
	}
});

function expectBodyPose(over: Partial<Entity>, sprite: Sprite) {
	const buf = new FakeBuffer(40, 16);
	const e = makeEntity({ type: 'player', y: 7, facing: 1, ...over });
	drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h + (FORMS[0].baseline ?? 0));
	expectSpriteAt(buf, sprite, ax, ay, e.facing, fgFor);
}

test('a moving Avatar animates the distance-driven walk cycle; standing freezes to idle (ADR 0020 §7)', () => {
	const idle = formFrame(FORMS[0], 'idle');
	const walkA = formFrame(FORMS[0], 'walkA');
	const walkB = formFrame(FORMS[0], 'walkB');

	// 2·STRIDE+3 is an even stride (walkA); 3·STRIDE+3 the next, odd one (walkB).
	expectBodyPose({ x: 2 * STRIDE + 3, vx: 3 }, walkA);
	expectBodyPose({ x: 3 * STRIDE + 3, vx: 3 }, walkB);

	expectBodyPose({ x: 3 * STRIDE + 3, vx: 0 }, idle);
});

test('an observer renders the same walk frame as the owner for a given position (ADR 0020 §7)', () => {
	const owner = makeEntity({ type: 'player', x: 3 * STRIDE + 3, y: 7, vx: 3 });
	const observer = makeEntity({
		type: 'player',
		x: 3 * STRIDE + 3,
		y: 7,
		vx: 3,
		action: {
			move: 'idle',
			phase: 'windup',
			progress: 0,
			flags: 0,
			emote: null,
			emoteT: 0,
		},
	});

	const render = (e: Entity) => {
		const buf = new FakeBuffer(40, 16);
		drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
		return buf;
	};
	const walkB = formFrame(FORMS[0], 'walkB');
	const ax = Math.round(3 * STRIDE + 3 - Math.floor((walkB.w - BOX.w) / 2));
	const ay = Math.round(7 + BOX.h - walkB.h + (FORMS[0].baseline ?? 0));
	expectSpriteAt(render(owner), walkB, ax, ay, 1, fgFor);
	expectSpriteAt(render(observer), walkB, ax, ay, 1, fgFor);
});

test('an airborne Avatar does not walk even while moving horizontally (ADR 0020 ladder)', () => {
	const jump = formFrame(FORMS[0], 'jump');
	expectBodyPose({ x: 3 * STRIDE + 3, vx: 3, onGround: false }, jump);
});

test("cosmetic hue recolours the Avatar's body cells, leaving other keys untouched", () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 2, hat: '', nameplate: 0, form: 'buddy' },
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
	const hatId = 'cap';
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 0, hat: hatId, nameplate: 0, form: 'buddy' },
	});

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const hat = hatById(hatId);
	if (!hat) throw new Error('expected a hat sprite');
	const { sprite, ax, ay } = avatarTopLeft(e);
	const hx = ax + Math.round((sprite.w - hat.w) / 2);
	const hy = ay - hat.h;
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
	const weapon = weaponSpriteById(0);
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

		const { sprite: body, ax: sx, ay: sy, grip } = avatarTopLeft(e);
		const bodyGripX = sx + (facing === 1 ? grip.x : body.w - 1 - grip.x);
		const bodyGripY = sy + grip.y;
		// The grip may sit outside the art (negative column), so it isn't a drawn cell.
		const wgx = facing === 1 ? weapon.grip.x : frame.w - 1 - weapon.grip.x;
		const wx: number = bodyGripX - wgx;
		const wy: number = bodyGripY - weapon.grip.y;

		expectSpriteAt(buf, frame, wx, wy, facing, weaponFgFor(weapon.accent));

		const wGlyphs = frame.rows(facing);
		const bGlyphs = body.rows(facing);
		let overlaps = 0;
		for (let ry = 0; ry < frame.h; ry++) {
			for (let rx = 0; rx < frame.w; rx++) {
				const wch = wGlyphs[ry][rx];
				if (wch === ' ') continue;
				const px = wx + rx;
				const py = wy + ry;
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

test('mid-active-swing the composited weapon plays the sweep frame, and no box-fill floods the melee hitbox (ADR 0018 §4/§5)', () => {
	const weapon = weaponSpriteById(0);
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	const sweep = weapon.frames.active;
	if (!sweep || sweep.length === 0)
		throw new Error('expected authored active sweep frames');

	const progress = 0.5;
	const frame = sweep[sweepIndex(progress, sweep.length)];

	const buf = new FakeBuffer(28, 16);
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = {
		move: 'basic',
		phase: 'active',
		progress,
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

	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	const bodyGripX = sx + grip.x;
	const bodyGripY = sy + grip.y;
	const wgx = weapon.grip.x;
	const wx = bodyGripX - wgx;
	const wy = bodyGripY - weapon.grip.y;

	const arcCells = new Set(
		bladeEdgeArc(progress, 1).map(
			(c) => `${bodyGripX + c.dx},${bodyGripY + c.dy}`,
		),
	);
	expectSpriteAt(buf, frame, wx, wy, 1, weaponFgFor(weapon.accent), (px, py) =>
		arcCells.has(`${px},${py}`),
	);

	const hb = meleeHitbox(e);
	let written = 0;
	let total = 0;
	for (let yy = 0; yy < hb.h; yy++) {
		for (let xx = 0; xx < hb.w; xx++) {
			total++;
			if (buf.at(Math.round(hb.x + xx), Math.round(hb.y + yy))) written++;
		}
	}
	expect(total).toBeGreaterThan(0);
	expect(written).toBeLessThan(total);
});

test('the active phase renders the blade-edge arc in the accent colour; other phases draw none (ADR 0018 §5/§6)', () => {
	const weapon = weaponSpriteById(0);
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	const accent = accentFg(weapon.accent);
	const progress = 0.5;

	const active = new FakeBuffer(28, 16);
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = {
		move: 'basic',
		phase: 'active',
		progress,
		flags: 0,
		emote: null,
		emoteT: 0,
	};
	renderZoneScene(
		active,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	const bodyGripX = sx + grip.x;
	const bodyGripY = sy + grip.y;

	const arc = bladeEdgeArc(progress, 1);
	expect(arc.length).toBeGreaterThan(0);
	for (const c of arc) {
		const cell = active.at(bodyGripX + c.dx, bodyGripY + c.dy);
		expect(cell?.ch).toBe(c.glyph);
		expect(cell?.fg).toBe(accent);
	}

	// Forward arc cells (|dx|=3) sit clear of the idle blade, so they stay untouched.
	const idle = new FakeBuffer(28, 16);
	const rest = makeEntity({
		type: 'player',
		x: 12,
		y: 6,
		facing: 1,
		weapon: 0,
	});
	renderZoneScene(
		idle,
		{ terrain: flat20(), portals: [], npcs: [], entities: [rest] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const forward = arc.filter((c) => Math.abs(c.dx) === 3);
	expect(forward.length).toBeGreaterThan(0);
	for (const c of forward)
		expect(idle.at(bodyGripX + c.dx, bodyGripY + c.dy)).toBeUndefined();
});

test('a weaponless Avatar draws no weapon layer', () => {
	const buf = new FakeBuffer(24, 16);
	const e = makeEntity({ type: 'player', x: 10, y: 6, facing: 1 });
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	// The sword's blade tip would sit a row above the body; with no weapon that cell stays empty.
	expect(buf.at(sx + grip.x, sy - 1)).toBeUndefined();
});

function bodyAnchor(e: Entity, sprite: Sprite) {
	const form = formById(e.cosmetics?.form);
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h + (form.baseline ?? 0));
	return { ax, ay };
}

test('a buddy Avatar plants its feet: each foot cell on the terrain surface is opaque, bg = terrainFg (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7 });

	renderZoneScene(
		buf,
		{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = formFrame(FORMS[0], 'idle');
	const { ax, ay } = bodyAnchor(e, sprite);
	const surface = Math.round(e.y + BOX.h);
	expect(ay + sprite.h - 1).toBe(surface);

	const glyphs = sprite.rows(1);
	const keys = sprite.colorKeys(1);
	const footRow = sprite.h - 1;
	let feet = 0;
	for (let rx = 0; rx < sprite.w; rx++) {
		const ch = glyphs[footRow][rx];
		if (ch === ' ') continue;
		feet++;
		const cell = buf.at(ax + rx, surface);
		expect(cell?.ch).toBe(ch);
		expect(cell?.fg).toBe(fgFor(keys[footRow][rx]));
		expect(cell?.bg).toBe('TFG');
		expect(cell?.blended).toBeFalsy();
	}
	expect(feet).toBeGreaterThan(0);
});

function expectPlantedFeet(buf: FakeBuffer, e: Entity, sprite: Sprite) {
	const { ax } = bodyAnchor(e, sprite);
	const surface = Math.round(e.y + BOX.h);
	const glyphs = sprite.rows(1);
	const keys = sprite.colorKeys(1);
	const footRow = sprite.h - 1;
	let feet = 0;
	for (let rx = 0; rx < sprite.w; rx++) {
		const ch = glyphs[footRow][rx];
		if (ch === ' ') continue;
		feet++;
		const cell = buf.at(ax + rx, surface);
		expect(cell?.ch).toBe(ch);
		expect(cell?.fg).toBe(fgFor(keys[footRow][rx]));
		expect(cell?.bg).toBe('TFG');
		expect(cell?.blended).toBeFalsy();
	}
	expect(feet).toBeGreaterThan(0);
}

test('the walk frames plant on the same general over-solid rule, no pose-specific code (ADR 0021)', () => {
	for (const [x, pose] of [
		[2 * STRIDE + 3, 'walkA'],
		[3 * STRIDE + 3, 'walkB'],
	] as const) {
		const buf = new FakeBuffer(40, 16);
		const e = makeEntity({ type: 'player', x, y: 7, vx: 3 });
		renderZoneScene(
			buf,
			{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
			{ x: 0, y: 0 },
			STYLE,
		);
		expectPlantedFeet(buf, e, formFrame(FORMS[0], pose));
	}
});

test('an airborne Avatar floats: its jump feet render transparent, not planted (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, onGround: false });
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const jump = formFrame(FORMS[0], 'jump');
	const { ax } = bodyAnchor(e, jump);
	const surface = Math.round(e.y + BOX.h);
	const glyphs = jump.rows(1);
	const footRow = jump.h - 1;
	let feet = 0;
	for (let rx = 0; rx < jump.w; rx++) {
		const ch = glyphs[footRow][rx];
		if (ch === ' ') continue;
		feet++;
		const cell = buf.at(ax + rx, surface);
		expect(cell?.ch).toBe(ch);
		expect(cell?.bg).toBe('TR');
		expect(cell?.bg).not.toBe('TFG');
		expect(cell?.blended).toBe(true);
	}
	expect(feet).toBeGreaterThan(0);
});

test('one foot past a platform edge floats while the other stays planted (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7 });
	const sprite = formFrame(FORMS[0], 'idle');
	const { ax } = bodyAnchor(e, sprite);
	const surface = Math.round(e.y + BOX.h);
	const glyphs = sprite.rows(1);
	const footRow = sprite.h - 1;
	const footCols: number[] = [];
	for (let rx = 0; rx < sprite.w; rx++)
		if (glyphs[footRow][rx] !== ' ') footCols.push(ax + rx);
	const leftFoot = footCols[0];
	const rightFoot = footCols[footCols.length - 1];
	const lip = Math.floor((leftFoot + rightFoot) / 2);

	const terrain = parseTerrain(
		Array.from({ length: 16 }, (_, r) =>
			r >= surface ? '#'.repeat(lip + 1).padEnd(20, '.') : '.'.repeat(20),
		),
	);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.at(leftFoot, surface)?.bg).toBe('TFG');
	expect(buf.at(leftFoot, surface)?.blended).toBeFalsy();
	expect(buf.at(rightFoot, surface)?.bg).toBe('TR');
	expect(buf.at(rightFoot, surface)?.blended).toBe(true);
});

test('an Avatar on a one-cell-thick platform still plants on its surface (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7 });
	const surface = Math.round(e.y + BOX.h);
	const terrain = parseTerrain(
		Array.from({ length: 16 }, (_, r) =>
			(r === surface ? '#' : '.').repeat(20),
		),
	);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expectPlantedFeet(buf, e, formFrame(FORMS[0], 'idle'));
});

test('a baseline-0 monster (chaser) blits unchanged — no planting (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'chaser', x: 8, y: 6 });
	renderZoneScene(
		buf,
		{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = spriteFor('chaser');
	expect(sprite.baseline).toBe(0);
	// baseline 0 leaves feet a cell above the surface (over air), so nothing plants — an accepted transitional float.
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	const ay = Math.round(e.y + BOX.h - sprite.h);
	expectSpriteAt(buf, sprite, ax, ay, 1, fgFor);
	const glyphs = sprite.rows(1);
	for (let ry = 0; ry < sprite.h; ry++)
		for (let rx = 0; rx < sprite.w; rx++) {
			if (glyphs[ry][rx] === ' ') continue;
			const cell = buf.at(ax + rx, ay + ry);
			expect(cell?.bg).toBe('TR');
			expect(cell?.blended).toBe(true);
		}
});

test('a cosmetic-hue Avatar keeps its recoloured body fg on the planted foot ink half (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 2, hat: '', nameplate: 0, form: 'buddy' },
	});
	renderZoneScene(
		buf,
		{ terrain: groundUnder(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const sprite = formFrame(FORMS[0], 'idle');
	const { ax } = bodyAnchor(e, sprite);
	const surface = Math.round(e.y + BOX.h);
	const glyphs = sprite.rows(1);
	const footRow = sprite.h - 1;
	let feet = 0;
	for (let rx = 0; rx < sprite.w; rx++) {
		if (glyphs[footRow][rx] === ' ') continue;
		feet++;
		const cell = buf.at(ax + rx, surface);
		expect(cell?.fg).toBe('hue2');
		expect(cell?.bg).toBe('TFG');
		expect(cell?.blended).toBeFalsy();
	}
	expect(feet).toBeGreaterThan(0);
});

test('combat telegraphs are exempt from planting: the blade-edge arc keeps its own bg over solid ground (ADR 0021)', () => {
	const buf = new FakeBuffer(28, 16);
	const terrain = parseTerrain(
		Array.from({ length: 16 }, () => '#'.repeat(28)),
	);
	const progress = 0.5;
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = {
		move: 'basic',
		phase: 'active',
		progress,
		flags: 0,
		emote: null,
		emoteT: 0,
	};
	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	const bodyGripX = sx + grip.x;
	const bodyGripY = sy + grip.y;
	const arc = bladeEdgeArc(progress, 1);
	expect(arc.length).toBeGreaterThan(0);
	for (const c of arc) {
		const cell = buf.at(bodyGripX + c.dx, bodyGripY + c.dy);
		expect(cell?.ch).toBe(c.glyph);
		expect(cell?.bg).toBe('TR');
		expect(cell?.bg).not.toBe('TFG');
		expect(cell?.blended).toBe(true);
	}
});

// ADR 0031: two-color cells (fg + bg both keyed) render through the same
// hurt/recolor/ghost pipeline as fg-only cells, applied to both channels.
const twoTone = new Sprite('▀█', { defaultKey: 'p', colors: 'ps', bg: 'k·' });

test('a two-color cell blits opaque with both fg and bg from the palette; a single-color cell stays alpha-blended', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE);

	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TR', blended: true });
});

test('hurt flashes both channels of a two-color cell; a single-color cell keeps its unchanged fg-only flash', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, 1, true, STYLE);

	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'HURT', bg: 'HURT' });
	expect(buf.at(1, 0)).toEqual({
		ch: '█',
		fg: 'HURT',
		bg: 'TR',
		blended: true,
	});
});

test('recolor resolves both channels of a two-color cell independently by key', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE, { p: 'HUE', k: 'KREC' });

	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'HUE', bg: 'KREC' });
});

test('ghost fades both channels of a two-color cell; a single-color cell keeps the ghost tint bg', () => {
	const buf = new FakeBuffer(4, 4);
	const fade = (fg: string) => `F(${fg})`;
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE, undefined, {
		bg: 'TINT',
		fade,
	});

	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'F(cP)', bg: 'F(cK)' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'F(cS)', bg: 'TINT' });
});

test('planting an entity over solid terrain keeps the authored bg on a two-color cell but overrides the single-color cell', () => {
	const buf = new FakeBuffer(4, 4);
	const terrain = parseTerrain(['##', '##']);
	blitSprite(buf, twoTone, 0, 0, 1, false, STYLE, undefined, undefined, {
		terrain,
		camX: 0,
		camY: 0,
	});

	expect(buf.at(0, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(1, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TFG' });
});

test('facing -1 mirrors the bg key positionally along with the glyph', () => {
	const buf = new FakeBuffer(4, 4);
	blitSprite(buf, twoTone, 0, 0, -1, false, STYLE);

	expect(buf.at(1, 0)).toEqual({ ch: '▀', fg: 'cP', bg: 'cK' });
	expect(buf.at(0, 0)).toEqual({ ch: '█', fg: 'cS', bg: 'TR', blended: true });
});
