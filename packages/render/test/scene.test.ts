import { expect, test } from 'bun:test';
import {
	type Drop,
	type Entity,
	SCENE_COLORS,
	type Terrain,
} from '@mmo/core/entities';
import { RARITY_COLOR } from '@mmo/core/items';
import { parseTerrain } from '@mmo/core/physics';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import {
	type DodgeEcho,
	drawDodgeEchoes,
	drawDrops,
	drawPortals,
	drawTerrain,
} from '@mmo/render/scene';
import { paintActor } from '@mmo/render/sprites';

const TERRAIN_FG = SCENE_COLORS.terrainFg;
const NO_CAM = { x: 0, y: 0 };

function eq(a: RGBA, b: RGBA): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function chaser(over: Partial<Entity> & Pick<Entity, 'id'>): Entity {
	return {
		type: 'chaser',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

// A field with a two-row solid floor: the top floor row is a surface, the row
// beneath it is interior. Sky fills the two empty rows above.
function floorField(): Terrain {
	return parseTerrain(['....', '....', '####', '####']);
}
const SURFACE_Y = 2;
const INTERIOR_Y = 3;

test('terrain composes as the sub-cell backdrop: interior fills a full block, surface only its lower half', () => {
	const c = new Compositor(4, 4);
	drawTerrain(c, floorField(), NO_CAM);

	const interior = c.cell(0, INTERIOR_Y);
	expect(interior.char).toBe('█');
	expect(eq(interior.fg, TERRAIN_FG)).toBe(true);

	const surface = c.cell(0, SURFACE_Y);
	expect(surface.char).toBe('▄');
	expect(eq(surface.fg, TERRAIN_FG)).toBe(true);
});

test('the surface cell keeps sky above ground: its upper half stays transparent', () => {
	const c = new Compositor(4, 4);
	drawTerrain(c, floorField(), NO_CAM);

	// The lower-half `▄` leaves the top quadrants transparent so the encoder's sky
	// backdrop shows through — the ground never bleeds a solid band upward.
	const surface = c.cell(0, SURFACE_Y);
	expect(surface.bg[3]).toBe(0);

	// The two rows above the surface are pure sky (no terrain drawn).
	expect(c.cell(0, 0).char).toBe(' ');
	expect(c.cell(0, 1).char).toBe(' ');
});

test('a sprite over terrain reveals the composed ground through its transparent quadrants, not a guess', () => {
	const c = new Compositor(24, 12);
	// A solid interior terrain field: every quadrant is terrain-coloured.
	drawTerrain(c, parseTerrain(Array(12).fill('#'.repeat(24))), NO_CAM);

	paintActor(c, chaser({ id: 1, x: 8, y: 4 }), NO_CAM);

	let revealed = 0;
	// A partial-coverage actor cell whose backdrop is the composed terrain,
	// never a passed-in sky guess.
	for (const row of c.surface())
		for (const cell of row)
			if (cell.char !== '█' && cell.char !== ' ' && eq(cell.bg, TERRAIN_FG))
				revealed++;
	expect(revealed).toBeGreaterThan(0);
});

test('portals render in the floor pass and derive their backdrop from composed terrain', () => {
	const c = new Compositor(4, 4);
	drawTerrain(c, parseTerrain(Array(4).fill('####')), NO_CAM);
	drawPortals(
		c,
		[{ x: 1, y: 1, w: 1, h: 1, target: 'z', arrival: { x: 0, y: 0 } }],
		NO_CAM,
	);

	const portal = c.cell(1, 1);
	expect(portal.char).toBe('▒');
	expect(eq(portal.fg, SCENE_COLORS.portal)).toBe(true);
	// Backdrop is the real terrain beneath, not a guessed colour.
	expect(eq(portal.bg, TERRAIN_FG)).toBe(true);
});

test('a floor-pass portal stays behind an actor drawn over it', () => {
	const terrain = parseTerrain(Array(12).fill('#'.repeat(24)));
	const portal = [
		{ x: 6, y: 2, w: 12, h: 8, target: 'z', arrival: { x: 0, y: 0 } },
	];
	const countPortals = (c: Compositor): number => {
		let n = 0;
		for (const row of c.surface())
			for (const cell of row) if (cell.char === '▒') n++;
		return n;
	};

	const floorOnly = new Compositor(24, 12);
	drawTerrain(floorOnly, terrain, NO_CAM);
	drawPortals(floorOnly, portal, NO_CAM);
	const withoutActor = countPortals(floorOnly);
	expect(withoutActor).toBeGreaterThan(0);

	const withActor = new Compositor(24, 12);
	drawTerrain(withActor, terrain, NO_CAM);
	drawPortals(withActor, portal, NO_CAM);
	// The actor paints after the floor pass (pass 3 over pass 2) and occludes it.
	paintActor(withActor, chaser({ id: 1, x: 10, y: 4 }), NO_CAM);
	expect(countPortals(withActor)).toBeLessThan(withoutActor);
});

test('drop glyphs render in the floor pass, coloured by rarity', () => {
	const c = new Compositor(8, 8);
	drawTerrain(c, parseTerrain(Array(8).fill('#'.repeat(8))), NO_CAM);
	const drop = {
		id: 1,
		owner: 0,
		ttl: 10,
		x: 3,
		y: 3,
		w: 1,
		h: 1,
		item: { rarity: 'legendary' },
	} as unknown as Drop;
	drawDrops(c, [drop], NO_CAM);

	// The glyph lands on the drop's rounded box centre / foot.
	const gx = Math.round(drop.x + drop.w / 2);
	const gy = Math.round(drop.y + drop.h - 1);
	const cell = c.cell(gx, gy);
	expect(cell.char).toBe('◆');
	expect(eq(cell.fg, RARITY_COLOR.legendary)).toBe(true);
});

test('dodge echoes render as translucent silhouettes in the floor pass', () => {
	const c = new Compositor(24, 12);
	drawTerrain(c, parseTerrain(Array(12).fill('#'.repeat(24))), NO_CAM);
	const echoes: readonly DodgeEcho[] = [
		{ x: 8, y: 4, facing: 1, type: 'chaser', ageMs: 0 },
	];
	drawDodgeEchoes(c, echoes, NO_CAM);

	let stamped = 0;
	for (const row of c.surface())
		for (const cell of row)
			if (cell.char !== '█' && cell.char !== ' ') stamped++;
	expect(stamped).toBeGreaterThan(0);
});

test('a fully faded echo draws nothing', () => {
	const c = new Compositor(24, 12);
	const echoes: readonly DodgeEcho[] = [
		{ x: 8, y: 4, facing: 1, type: 'chaser', ageMs: 10_000 },
	];
	drawDodgeEchoes(c, echoes, NO_CAM);

	for (const row of c.surface())
		for (const cell of row) expect(cell.char).toBe(' ');
});
