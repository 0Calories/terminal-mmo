import { expect, test } from 'bun:test';
import { bladeEdgeArc, meleeHitbox, sweepIndex } from '../src/combat';
import { BOX } from '../src/constants';
import {
	type CellBuffer,
	drawEntitySprite,
	type RenderStyle,
	renderZoneScene,
} from '../src/render';
import {
	FORMS,
	formFrame,
	HATS,
	type Sprite,
	STRIDE,
	spriteFor,
	spriteForNpc,
	WEAPON_ACCENT_KEY,
} from '../src/sprites';
import { parseTerrain } from '../src/terrain';
import type { Entity, EntityType, Facing } from '../src/types';
import { weaponById } from '../src/weapons';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	// True when written via setCellWithAlphaBlending (translucent), so tests can tell
	// an opaque frame cell from a terrain-revealing interior cell (ADR 0016).
	blended?: boolean;
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
		this.cells.set(`${x},${y}`, { ch, fg, bg, blended: true });
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
	// Screen cells another layer legitimately overwrites (e.g. the blade-edge arc drawn
	// on top of the active blade) — skipped so the frame check survives that overlay.
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
	nameplateWash: 'WASH',
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
		nameplateWashes: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'],
	},
};

const fgFor = (key: string) => STYLE.palette[key] ?? STYLE.paletteDefault;

// The colour resolved for the weapon's dynamic ACCENT palette key (ADR 0018 §6).
const accentFg = (accent: string) =>
	STYLE.palette[accent] ?? STYLE.paletteDefault;

// Weapon-frame fg: the blade's accent cells are repainted to the resolved accent colour
// (ADR 0018 §6), so a weapon-frame assertion resolves `WEAPON_ACCENT_KEY` to the accent,
// not the (absent) palette entry for `a`. Other keys (the guard) use the normal palette.
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

// A ground plane: every row at or below the terrain surface (the row the planted
// feet land on, `e.y + BOX.h`) is solid, so an Avatar's feet row samples solid
// ground while its body rows above do not.
const groundUnder = (e: Entity) => {
	const surface = Math.round(e.y + BOX.h);
	return parseTerrain(
		Array.from({ length: 16 }, (_, r) => (r >= surface ? '#' : '.').repeat(20)),
	);
};

test('terrain: a solid cell renders as a block; empty cells stay cleared', () => {
	// 6 wide, 4 tall, a single solid cell at world (3, 2). With air directly above, it is a
	// top surface, so it renders as the lower-half block `▄` (the lowered ground line, ADR 0021).
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.cleared).toBe('BG');
	// Surface cell: ground in the lower half (`▄`/`TFG`), sky in the upper half — so its bg
	// is the scene `BG`, not `terrainBg`, and the empty half vanishes into the background.
	expect(buf.at(3, 2)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' });
	expect(buf.at(0, 0)).toBeUndefined();
});

test('the terrain top surface lowers to ▄; interior cells stay █ (ADR 0021)', () => {
	// Two stacked solid rows: the upper is a top surface (air above) → `▄`; the lower has
	// solid above → full `█`. The half-cell ground line lets slim contact feet plant flush.
	const terrain = parseTerrain(['......', '...#..', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 0, y: 0 },
		STYLE,
	);

	expect(buf.at(3, 1)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' }); // surface: sky bg
	expect(buf.at(3, 2)).toEqual({ ch: '█', fg: 'TFG', bg: 'TBG' }); // interior
});

test('terrain scrolls with the camera', () => {
	// Solid at world (3, 2); camera at (2, 1) shifts it to screen (1, 1). Air above → `▄`.
	const terrain = parseTerrain(['......', '......', '...#..', '......']);
	const buf = new FakeBuffer(6, 4);

	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [] },
		{ x: 2, y: 1 },
		STYLE,
	);

	expect(buf.at(1, 1)).toEqual({ ch: '▄', fg: 'TFG', bg: 'BG' }); // surface: sky bg
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
	// The shooter sprite has both solid full blocks and partial puzzle-shape blocks;
	// every one must survive unchanged (no glyph swap) — only the colour is faded.
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
			// Every cell in the sprite's bounding box carries the tint — lit OR
			// transparent — so the footprint reads as one solid rectangle (#118).
			expect(cell?.bg).toBe('TINT');
			if (ch === ' ') {
				expect(cell?.ch).toBe(' '); // a transparent cell, filled with the tint
				sawFilledGap = true;
				continue;
			}
			expect(cell?.ch).toBe(ch); // glyph kept exactly — no swap
			expect(cell?.fg).toBe(fade(fgFor(keys[ry][rx]))); // colour run through fade
			if (ch === '█')
				sawSolid = true; // a solid full block...
			else sawPartial = true; // ...and a puzzle-shape block both survive
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

// A terrain whose only solid rows are the two the chip occupies, so the whole pill
// samples solid ground (its body is drawn) and the shape can be asserted glyph by glyph.
const terrainUnderChip = (e: Entity) => {
	const boxTop = Math.round(e.y + BOX.h);
	return parseTerrain(
		Array.from({ length: 16 }, (_, r) =>
			(r === boxTop || r === boxTop + 1 ? '#' : '.').repeat(20),
		),
	);
};

test('a named entity gets a 2-row pill nameplate below its sprite', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: terrainUnderChip(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	// The chip top sits on the row directly below the feet (one past the Sprite's last
	// row), centred over the box; its width is the handle + a pad column + a corner each
	// side.
	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// Top row: ▟ · pad · n e o · pad · ▙
	expect(buf.at(left, boxTop)?.ch).toBe('▟');
	expect(buf.at(left + 1, boxTop)?.ch).toBe(' ');
	expect(buf.at(left + 2, boxTop)?.ch).toBe('n');
	expect(buf.at(left + 3, boxTop)?.ch).toBe('e');
	expect(buf.at(left + 4, boxTop)?.ch).toBe('o');
	expect(buf.at(left + 5, boxTop)?.ch).toBe(' ');
	expect(buf.at(left + 6, boxTop)?.ch).toBe('▙');
	// Bottom row: a thin lip with rounded ends — ▝ ▀▀▀▀▀ ▘
	expect(buf.at(left, boxTop + 1)?.ch).toBe('▝');
	expect(buf.at(left + 1, boxTop + 1)?.ch).toBe('▀');
	expect(buf.at(left + 6, boxTop + 1)?.ch).toBe('▘');
});

// --- Cosmetics (#35) -------------------------------------------------------

// The own Avatar is drawn directly (not via the z-ordered scene loop), so the
// cosmetic tests render through drawEntitySprite to pin the per-Avatar overrides.
function avatarTopLeft(e: Entity) {
	// The Avatar body is now its Form's resolved Pose (idle this slice); the grip/head
	// anchors live on the Form, not the Sprite (ADR 0020).
	const form = FORMS[e.cosmetics?.form ?? 0];
	const sprite = formFrame(form, 'idle');
	const ax = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2));
	// The Form's baseline shifts the whole body down so its feet plant on the surface
	// (ADR 0021); the buddy carries `baseline: 1`, so the anchor must include it.
	const ay = Math.round(e.y + BOX.h - sprite.h + (form.baseline ?? 0));
	return { sprite, ax, ay, grip: form.grip, head: form.head };
}

test("an Avatar renders its Form's idle Pose as its body, through the bodyFrame selector (ADR 0020)", () => {
	const buf = new FakeBuffer(20, 16);
	// A resting Avatar: the body must be FORMS[0]'s `idle` grid (drawn via bodyFrame +
	// formFrame), not a hardcoded sprite. Mirrored correctly when facing left.
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

// Render one Avatar's body and assert the expected Pose grid landed at the body anchor.
// Pins the render WIRING (which replicated signals reach the selector), not appearance:
// the expected grid is pulled from the same Form the renderer uses, so it survives art
// iteration. Every walk Pose shares idle's torso and differs only on the feet row, so a
// pose assertion really discriminates on the animated feet.
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

	// Moving on the ground (vx ≠ 0): the foot frame is chosen from the Avatar's own
	// replicated position — `walkA`/`walkB` flip at each STRIDE boundary of |x|. Position
	// 2·STRIDE+3 sits in an even stride (walkA); 3·STRIDE+3 in the next, odd one (walkB).
	expectBodyPose({ x: 2 * STRIDE + 3, vx: 3 }, walkA);
	expectBodyPose({ x: 3 * STRIDE + 3, vx: 3 }, walkB);

	// Standing still (vx 0) at that same walkB position holds idle: the cycle freezes to
	// the rest Pose rather than locking mid-stride — gait is gated on actually moving.
	expectBodyPose({ x: 3 * STRIDE + 3, vx: 0 }, idle);
});

test('an observer renders the same walk frame as the owner for a given position (ADR 0020 §7)', () => {
	// The owner derives its action from the predicted `attackT` (no replicated `action`);
	// an observer carries the snapshot `action`. The gait reads only `x`/`vx`/`onGround` —
	// the same replicated fields for both — so both compute the identical foot frame.
	const owner = makeEntity({ type: 'player', x: 3 * STRIDE + 3, y: 7, vx: 3 });
	const observer = makeEntity({
		type: 'player',
		x: 3 * STRIDE + 3,
		y: 7,
		vx: 3,
		action: { move: 'idle', phase: 'windup', progress: 0, flags: 0 },
	});

	const render = (e: Entity) => {
		const buf = new FakeBuffer(40, 16);
		drawEntitySprite(buf, e, { x: 0, y: 0 }, STYLE);
		return buf;
	};
	const walkB = formFrame(FORMS[0], 'walkB');
	const ax = Math.round(3 * STRIDE + 3 - Math.floor((walkB.w - BOX.w) / 2));
	const ay = Math.round(7 + BOX.h - walkB.h + (FORMS[0].baseline ?? 0));
	// Both land the same walkB grid at the same anchor — owner/observer agree.
	expectSpriteAt(render(owner), walkB, ax, ay, 1, fgFor);
	expectSpriteAt(render(observer), walkB, ax, ay, 1, fgFor);
});

test('an airborne Avatar does not walk even while moving horizontally (ADR 0020 ladder)', () => {
	// Off the ground the body sits above walk on the ladder (jump > walk), so a
	// horizontally-moving jumper poses the authored `jump` frame — proving the render
	// path honours `airborne` and does NOT pose a walk frame in the air.
	const jump = formFrame(FORMS[0], 'jump');
	expectBodyPose({ x: 3 * STRIDE + 3, vx: 3, onGround: false }, jump);
});

test("cosmetic hue recolours the Avatar's body cells, leaving other keys untouched", () => {
	const buf = new FakeBuffer(20, 16);
	// hue 2 -> 'hue2'; the player sprite is entirely the 'p' body key.
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 2, hat: 0, nameplate: 0, form: 0 },
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
		cosmetics: { hue: 0, hat: hatIdx, nameplate: 0, form: 0 },
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

test('an equipped Avatar at rest renders the weapon idle frame at the mirrored grip, on top of the body (ADR 0018)', () => {
	const weapon = weaponById(0).sprite; // default Sword
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
		// Body grip cell, its column reflected across the body when facing left.
		const bodyGripX = sx + (facing === 1 ? grip.x : body.w - 1 - grip.x);
		const bodyGripY = sy + grip.y;
		// Weapon grip cell, mirrored alongside the art so grip lands on grip. The grip
		// may sit OUTSIDE the art (a negative column anchoring the blade beside the hand),
		// so it isn't necessarily a drawn cell — placement below is asserted from it.
		const wgx = facing === 1 ? weapon.grip.x : frame.w - 1 - weapon.grip.x;
		const wx: number = bodyGripX - wgx;
		const wy: number = bodyGripY - weapon.grip.y;

		// Every lit weapon glyph landed at the grip-anchored, facing-mirrored position,
		// the blade in the resolved accent colour (ADR 0018 §6).
		expectSpriteAt(buf, frame, wx, wy, facing, weaponFgFor(weapon.accent));

		// Where a lit weapon cell lands on a lit BODY cell, the weapon is drawn on top,
		// so the composited cell shows the weapon glyph — not the body's underneath. Found
		// generically (no assumption about which cell overlaps) so the test survives art
		// iteration; we also assert such an overlap exists, or the on-top check is vacuous.
		const wGlyphs = frame.rows(facing);
		const bGlyphs = body.rows(facing);
		let overlaps = 0;
		for (let ry = 0; ry < frame.h; ry++) {
			for (let rx = 0; rx < frame.w; rx++) {
				const wch = wGlyphs[ry][rx];
				if (wch === ' ') continue;
				const px = wx + rx;
				const py = wy + ry;
				// Is the body lit at this same screen cell?
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
	const weapon = weaponById(0).sprite; // default Sword
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	const sweep = weapon.frames.active;
	if (!sweep || sweep.length === 0)
		throw new Error('expected authored active sweep frames');

	// Half-way through the active phase samples the middle sweep frame (first at 0,
	// last at 1) — the same pure mapping owner-prediction and observer-render share.
	const progress = 0.5;
	const frame = sweep[sweepIndex(progress, sweep.length)];

	const buf = new FakeBuffer(28, 16);
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	// An observer reads the swing from the replicated action-state (move/phase/progress).
	e.action = { move: 'basic', phase: 'active', progress, flags: 0 };
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	const bodyGripX = sx + grip.x; // facing 1
	const bodyGripY = sy + grip.y;
	const wgx = weapon.grip.x; // facing 1
	const wx = bodyGripX - wgx;
	const wy = bodyGripY - weapon.grip.y;

	// The active sweep frame's lit blade cells land at the grip-anchored position, in the
	// resolved accent colour (ADR 0018 §6) — skipping the cells the blade-edge arc draws on
	// top of (asserted separately below).
	const arcCells = new Set(
		bladeEdgeArc(progress, 1).map(
			(c) => `${bodyGripX + c.dx},${bodyGripY + c.dy}`,
		),
	);
	expectSpriteAt(buf, frame, wx, wy, 1, weaponFgFor(weapon.accent), (px, py) =>
		arcCells.has(`${px},${py}`),
	);

	// The legacy `╱`/`╲` box-fill is RETIRED: the melee hitbox is purely logical and is
	// never flood-filled. Prove it — count the written cells across the hitbox region;
	// a fill would have written EVERY cell, so at least one must remain untouched.
	const hb = meleeHitbox(e, weaponById(0).reach);
	let written = 0;
	let total = 0;
	for (let yy = 0; yy < hb.h; yy++) {
		for (let xx = 0; xx < hb.w; xx++) {
			total++;
			if (buf.at(Math.round(hb.x + xx), Math.round(hb.y + yy))) written++;
		}
	}
	expect(total).toBeGreaterThan(0);
	expect(written).toBeLessThan(total); // not a solid fill — the box-fill is gone
});

test('the active phase renders the blade-edge arc in the accent colour; other phases draw none (ADR 0018 §5/§6)', () => {
	const weapon = weaponById(0).sprite; // default Sword
	if (!weapon) throw new Error('expected the default weapon to have a sprite');
	const accent = accentFg(weapon.accent);
	const progress = 0.5;

	// Mid-active: every blade-edge arc cell is written, as its curve glyph in the accent
	// colour (drawn on top of the blade). The arc traces the tip — NOT a hitbox fill.
	const active = new FakeBuffer(28, 16);
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = { move: 'basic', phase: 'active', progress, flags: 0 };
	renderZoneScene(
		active,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	const bodyGripX = sx + grip.x; // facing 1
	const bodyGripY = sy + grip.y;

	const arc = bladeEdgeArc(progress, 1);
	expect(arc.length).toBeGreaterThan(0);
	for (const c of arc) {
		const cell = active.at(bodyGripX + c.dx, bodyGripY + c.dy);
		expect(cell?.ch).toBe(c.glyph);
		expect(cell?.fg).toBe(accent); // the accent colour reaches the arc cells
	}

	// At rest (idle: no action, attackT 0) there is NO arc. The forward arc cells (|dx| = 3)
	// sit clear of the narrow idle blade and the body, so they stay untouched.
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
	// Same body, but no equipped weapon (weapon undefined): the weapon layer is skipped.
	const e = makeEntity({ type: 'player', x: 10, y: 6, facing: 1 });
	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);
	const { ax: sx, ay: sy, grip } = avatarTopLeft(e);
	// The sword's blade tip sits a row above the body top when equipped; with no weapon
	// that cell stays empty, proving the layer is gated on an equipped weapon.
	expect(buf.at(sx + grip.x, sy - 1)).toBeUndefined();
});

test('over terrain the pill is a cosmetic-colour wash and the handle sits on it (ADR 0016)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		name: 'neo',
		// hat present to prove it no longer affects the (now below-feet) chip position
		cosmetics: { hue: 0, hat: 3, nameplate: 4, form: 0 },
	});

	renderZoneScene(
		buf,
		{ terrain: terrainUnderChip(e), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// Top-left corner: the bevel glyph is the wash (w4) blended in; its empty quadrant
	// (transparent bg) keeps the terrain base flattened underneath.
	expect(buf.at(left, boxTop)).toEqual({
		ch: '▟',
		fg: 'w4',
		bg: 'TR',
		blended: true,
	});
	// Pad cell: the whole cell is the cosmetic wash (w4), blended over the terrain base.
	expect(buf.at(left + 1, boxTop)).toEqual({
		ch: ' ',
		fg: 'w4',
		bg: 'w4',
		blended: true,
	});
	// Handle char is the chosen cosmetic colour (np4) at full opacity, on the wash backing.
	expect(buf.at(left + 2, boxTop)).toEqual({
		ch: 'n',
		fg: 'np4',
		bg: 'w4',
		blended: true,
	});
});

test('off terrain the pill is omitted and only the handle shows (ADR 0016)', () => {
	const buf = new FakeBuffer(20, 16);
	// flat20 is all-empty, so no chip cell is over solid ground.
	const e = makeEntity({ type: 'player', x: 8, y: 7, name: 'neo' });

	renderZoneScene(
		buf,
		{ terrain: flat20(), portals: [], npcs: [], entities: [e] },
		{ x: 0, y: 0 },
		STYLE,
	);

	const boxTop = Math.round(e.y + BOX.h);
	const cx = e.x + BOX.w / 2;
	const left = Math.round(cx - ('neo'.length + 4) / 2);
	// The pill body (corner, lip) is not drawn at all off terrain. The buddy's planted
	// baseline now lands its feet ON the chip's top row (ADR 0021), so a foot may float
	// transparently over a top-row pad cell — assert pill-omission on the bottom lip row,
	// which is below the feet and pure pill territory.
	const lastCol = 'neo'.length + 4 - 1;
	expect(buf.at(left, boxTop + 1)).toBeUndefined();
	expect(buf.at(left + 1, boxTop + 1)).toBeUndefined();
	expect(buf.at(left + lastCol, boxTop + 1)).toBeUndefined();
	// Only the handle glyph shows, floating on whatever is behind (transparent bg, the
	// default dim-grey ink since this entity has no cosmetics).
	expect(buf.at(left + 2, boxTop)).toEqual({
		ch: 'n',
		fg: 'NAME',
		bg: 'TR',
		blended: true,
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
			cosmetics: { hue: 0, hat, nameplate: 0, form: 0 },
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
	// Handle 'a' sits at column 2 of the chip (after the corner + pad); it's drawn on
	// the top row regardless of terrain, so it pins the chip's row directly.
	const left = Math.round(8 + BOX.w / 2 - ('a'.length + 4) / 2);
	// No hat vs the tallest hat (Wizard, 3 rows): the handle lands on the same row
	// either way, since the chip anchors below the feet now (#103).
	expect(render(0).at(left + 2, boxTop)?.ch).toBe('a');
	expect(render(3).at(left + 2, boxTop)?.ch).toBe('a');
});

// --- Sprite ground contact: planted feet (#210, ADR 0021) ------------------

// The screen anchor of an Avatar's resolved Pose, baseline included. The buddy Form
// carries `baseline: 1`, which shifts the WHOLE sprite down one cell so its bottom
// (feet) row lands on the terrain surface row instead of one cell above it (ADR 0021).
function bodyAnchor(e: Entity, sprite: Sprite) {
	const form = FORMS[e.cosmetics?.form ?? 0];
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
	// The baseline lands the sprite's last row exactly on the terrain surface row.
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
		// Foot glyph kept, fg = body colour, bg painted with the visible terrain block
		// colour — written OPAQUELY (no dark terrainBg notch under the boot).
		expect(cell?.ch).toBe(ch);
		expect(cell?.fg).toBe(fgFor(keys[footRow][rx]));
		expect(cell?.bg).toBe('TFG');
		expect(cell?.blended).toBeFalsy();
	}
	expect(feet).toBeGreaterThan(0);
});

// Assert every lit cell of `sprite`'s bottom (feet) row that lands over solid ground is
// planted: foot glyph kept, body-colour fg, opaque `terrainFg` background. Shared so the
// idle / walk frames are all checked on the one general over-solid rule (ADR 0021).
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
	// Drive the distance-driven selector to each walk frame and confirm BOTH plant — the
	// rule keys on `isSolid` under each cell, not on which Pose is showing.
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
	// Off the ground and above empty space (no solid under the feet row): the baseline
	// still applies every frame, but the over-solid composite does NOT fire, so the feet
	// stay see-through `▀` hanging in air — the correct read for feet touching nothing.
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
		// Transparent / alpha-blended — bg is NOT the terrain block colour.
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
	// The idle feet sit at the sprite's outer columns; build a platform whose lip falls
	// between them, so the left foot is over solid ground and the right foot hangs past it.
	const glyphs = sprite.rows(1);
	const footRow = sprite.h - 1;
	const footCols: number[] = [];
	for (let rx = 0; rx < sprite.w; rx++)
		if (glyphs[footRow][rx] !== ' ') footCols.push(ax + rx);
	const leftFoot = footCols[0];
	const rightFoot = footCols[footCols.length - 1];
	const lip = Math.floor((leftFoot + rightFoot) / 2); // solid up to here, air after

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

	// The planted foot is opaque over the terrain colour; the foot past the lip floats.
	expect(buf.at(leftFoot, surface)?.bg).toBe('TFG');
	expect(buf.at(leftFoot, surface)?.blended).toBeFalsy();
	expect(buf.at(rightFoot, surface)?.bg).toBe('TR');
	expect(buf.at(rightFoot, surface)?.blended).toBe(true);
});

test('an Avatar on a one-cell-thick platform still plants on its surface (ADR 0021)', () => {
	const buf = new FakeBuffer(20, 16);
	const e = makeEntity({ type: 'player', x: 8, y: 7 });
	const surface = Math.round(e.y + BOX.h);
	// A single solid row (air above and below) — the over-solid check is per cell on the
	// surface row, so the feet plant regardless of how thick the ground is beneath.
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
	// baseline 0 keeps the anchor exactly where it was — feet one cell ABOVE the surface,
	// over air — so the over-solid composite never fires and every cell blits transparently
	// just like before. (The sprite is unchanged; with the lowered `▄` ground line it now
	// floats a half-cell until it adopts `▀` contact feet — the accepted transitional state,
	// ADR 0021 decision 5.) Pin the unchanged placement and transparent backgrounds.
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
	// hue 2 -> 'hue2'; the body (incl. the feet) is the 'p' key, so the planted foot's ink
	// half must carry the recoloured hue over the terrain-colour background.
	const e = makeEntity({
		type: 'player',
		x: 8,
		y: 7,
		cosmetics: { hue: 2, hat: 0, nameplate: 0, form: 0 },
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
		expect(cell?.fg).toBe('hue2'); // recoloured body ink, not the default 'cP'
		expect(cell?.bg).toBe('TFG'); // planted over the terrain colour
		expect(cell?.blended).toBeFalsy();
	}
	expect(feet).toBeGreaterThan(0);
});

test('combat telegraphs are exempt from planting: the blade-edge arc keeps its own bg over solid ground (ADR 0021)', () => {
	const buf = new FakeBuffer(28, 16);
	// Terrain solid EVERYWHERE, so every body/weapon cell would plant — but the blade-edge
	// arc renders above with its own transparent bg and must stay exempt (it is a
	// live-motion telegraph, not part of the body/sprite layer).
	const terrain = parseTerrain(
		Array.from({ length: 16 }, () => '#'.repeat(28)),
	);
	const progress = 0.5;
	const e = makeEntity({ type: 'player', x: 12, y: 6, facing: 1, weapon: 0 });
	e.action = { move: 'basic', phase: 'active', progress, flags: 0 };
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
		// Arc cell carries its own translucent bg — NOT painted with the terrain colour.
		expect(cell?.ch).toBe(c.glyph);
		expect(cell?.bg).toBe('TR');
		expect(cell?.bg).not.toBe('TFG');
		expect(cell?.blended).toBe(true);
	}
});
