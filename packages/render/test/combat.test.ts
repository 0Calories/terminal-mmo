import { expect, test } from 'bun:test';
import { swingOverlayCell, swingPhase } from '@mmo/core/combat';
import { BOX, type Entity, type Projectile } from '@mmo/core/entities';
import { parseTerrain } from '@mmo/core/physics';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import {
	drawGuard,
	drawProjectiles,
	drawSkillTelegraphs,
	drawSwing,
	drawTerrain,
} from '@mmo/render/scene';
import { paintActor } from '@mmo/render/sprites';

const NO_CAM = { x: 0, y: 0 };
const TELEGRAPH: RGBA = [255, 245, 200, 255];
const GUARD: RGBA = [150, 200, 255, 255];
const PROJECTILE: RGBA = [255, 120, 80, 255];

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

// A solid terrain field: every cell composes as opaque terrain pixels, so any
// glyph stamped without an authored backdrop derives that terrain colour — a
// black box would prove the derive was skipped.
function solidField(w: number, h: number): Compositor {
	const c = new Compositor(w, h);
	drawTerrain(c, parseTerrain(Array(h).fill('#'.repeat(w))), NO_CAM);
	return c;
}

// Find the one cell carrying a given glyph.
function findGlyph(c: Compositor, char: string): { x: number; y: number } {
	const rows = c.surface();
	for (let y = 0; y < rows.length; y++)
		for (let x = 0; x < rows[y].length; x++)
			if (rows[y][x].char === char) return { x, y };
	throw new Error(`glyph ${char} not found`);
}

test('a swing glyph composes over the scene and derives its backdrop, not a black box', () => {
	const c = solidField(24, 12);
	const attacker = chaser({ id: 1, x: 8, y: 4, facing: 1, attackT: 0.05 });
	paintActor(c, attacker, NO_CAM);

	drawSwing(c, attacker, NO_CAM, TELEGRAPH);

	// The swing stamps `╱` (facing 1) at the overlay cell for the current phase.
	const phase = swingPhase(attacker.attackT);
	if (!phase) throw new Error('expected a swing phase');
	const at = swingOverlayCell(attacker, phase);
	const cell = c.cell(at.x, at.y);
	expect(cell.char).toBe('╱');
	expect(eq(cell.fg, TELEGRAPH)).toBe(true);
	// The backdrop is a real composed colour derived from the scene, never a
	// guessed/transparent black box.
	expect(cell.bg[3]).toBeGreaterThan(0);
});

test('combat sits above pass 3-4 actors: a telegraph wins a cell the actor occupies', () => {
	const avatar = chaser({ id: 1, x: 10, y: 6, facing: 1 });

	// A terrain-only reference to tell actor pixels apart from bare terrain.
	const terrainOnly = solidField(40, 16);
	const scene = solidField(40, 16);
	paintActor(scene, avatar, NO_CAM);

	// An actor-occupied cell inside the ground-pound hitbox rows [e.y, e.y+BOX.h):
	// its char differs from the same cell drawn with terrain alone.
	const sceneRows = scene.surface();
	const refRows = terrainOnly.surface();
	let occupied: { x: number; y: number } | null = null;
	for (let y = avatar.y; y < avatar.y + BOX.h && !occupied; y++)
		for (let x = 0; x < sceneRows[y].length; x++)
			if (sceneRows[y][x].char !== refRows[y][x].char) {
				occupied = { x, y };
				break;
			}
	if (!occupied) throw new Error('actor drew nothing over the hitbox rows');

	drawSkillTelegraphs(
		scene,
		avatar,
		'warrior',
		{ 'ground-pound': 6 },
		NO_CAM,
		TELEGRAPH,
	);

	// Pass 5 drew after pass 3-4, so the telegraph owns the once-actor cell.
	expect(scene.cell(occupied.x, occupied.y).char).toBe('✦');
});

test('a guard glyph composes over an actor and derives its backdrop from the scene', () => {
	const c = solidField(24, 12);
	const guarding = chaser({ id: 1, x: 8, y: 4, facing: 1, guardT: 5 });
	paintActor(c, guarding, NO_CAM);

	drawGuard(c, guarding, NO_CAM, GUARD);

	const at = findGlyph(c, '┃');
	const cell = c.cell(at.x, at.y);
	expect(eq(cell.fg, GUARD)).toBe(true);
	expect(cell.bg[3]).toBeGreaterThan(0);
});

test('skill telegraphs stamp over the actor and reveal the terrain beneath', () => {
	const c = solidField(40, 16);
	const avatar = chaser({ id: 1, x: 10, y: 6, facing: 1 });
	paintActor(c, avatar, NO_CAM);

	// A freshly spent cooldown so the telegraph shows.
	drawSkillTelegraphs(
		c,
		avatar,
		'warrior',
		{ 'power-strike': 2.5 },
		NO_CAM,
		TELEGRAPH,
	);

	const at = findGlyph(c, '✦');
	const cell = c.cell(at.x, at.y);
	expect(eq(cell.fg, TELEGRAPH)).toBe(true);
	expect(cell.bg[3]).toBeGreaterThan(0);
});

test('a spent-long-ago cooldown draws no telegraph', () => {
	const c = solidField(40, 16);
	const avatar = chaser({ id: 1, x: 10, y: 6, facing: 1 });
	drawSkillTelegraphs(
		c,
		avatar,
		'warrior',
		{ 'power-strike': 0 },
		NO_CAM,
		TELEGRAPH,
	);
	for (const row of c.surface())
		for (const cell of row) expect(cell.char).not.toBe('✦');
});

test('a projectile composes over an actor and reveals the scene, glyph by velocity', () => {
	const c = solidField(24, 12);
	paintActor(c, chaser({ id: 1, x: 10, y: 4 }), NO_CAM);

	const projectiles: readonly Projectile[] = [
		{
			id: 1,
			x: 11,
			y: 5,
			vx: -8,
			vy: 0,
			life: 2,
			damage: 4,
			poiseDamage: 1,
			knockback: 0,
			knockbackUp: 0,
		},
	];
	drawProjectiles(c, projectiles, NO_CAM, PROJECTILE);

	const at = findGlyph(c, '◄'); // leftward velocity
	const cell = c.cell(at.x, at.y);
	expect(eq(cell.fg, PROJECTILE)).toBe(true);
	expect(cell.bg[3]).toBeGreaterThan(0);
});

test('projectile glyphs follow horizontal velocity direction', () => {
	const right = new Compositor(8, 8);
	drawProjectiles(
		right,
		[
			{
				id: 1,
				x: 4,
				y: 4,
				vx: 6,
				vy: 0,
				life: 2,
				damage: 4,
				poiseDamage: 1,
				knockback: 0,
				knockbackUp: 0,
			},
		],
		NO_CAM,
		PROJECTILE,
	);
	expect(right.cell(4, 4).char).toBe('►');

	const still = new Compositor(8, 8);
	drawProjectiles(
		still,
		[
			{
				id: 1,
				x: 4,
				y: 4,
				vx: 0,
				vy: 5,
				life: 2,
				damage: 4,
				poiseDamage: 1,
				knockback: 0,
				knockbackUp: 0,
			},
		],
		NO_CAM,
		PROJECTILE,
	);
	expect(still.cell(4, 4).char).toBe('●');
});
