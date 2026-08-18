import { expect, test } from 'bun:test';
import type { BrainView, Entity, Terrain } from '../../../../src/entities';
import { boxOf, MONSTERS, spawnMonster } from '../../../../src/entities';
import type { EngineMemory } from '../../../../src/entities/monsters';
import { hopEngine } from '../../../../src/entities/monsters/slime';
import { parseTerrain } from '../../../../src/physics';
import { GROUND_TOP } from '../../../../src/zones';
import { flatTerrain, islandTerrain, SPAWN_Y } from '../../../helpers';

const SHAPE = {
	rest: { patrol: 4, approach: 2 },
	speed: 1.35,
	jump: 0.8,
} as const;

const hop = hopEngine(SHAPE)(MONSTERS.slime.stats);
const flat = flatTerrain();

function view(terrain: Terrain = flat): BrainView {
	return { terrain, targetX: null };
}

/** Flat ground walled in on both sides of a single cell-wide corridor. */
function cellTerrain(leftWall: number, rightWall: number): Terrain {
	const rows: string[] = [];
	for (let cy = 0; cy < GROUND_TOP + 3; cy++) {
		let row = '';
		for (let cx = 0; cx < 60; cx++)
			row +=
				cy >= GROUND_TOP || cx === leftWall || cx === rightWall ? '#' : '.';
		rows.push(row);
	}
	return parseTerrain(rows);
}

function grounded(x: number): Entity {
	const m = spawnMonster('slime', 2, x, SPAWN_Y);
	m.onGround = true;
	return m;
}

function airborne(x: number): Entity {
	const m = spawnMonster('slime', 2, x, SPAWN_Y - 5);
	m.onGround = false;
	return m;
}

test('the gait never walks: a grounded wander either hops or stands still', () => {
	let memory: EngineMemory | undefined;
	const m = grounded(50);
	for (let i = 0; i < 20; i++) {
		const step = hop.wander(m, view(), memory);
		memory = step.memory;
		if (!step.drive.jump) expect(step.drive.moveX).toBe(0);
	}
});

test('hops are lazy: the patrol cadence rests between consecutive hops', () => {
	const m = grounded(50);
	const launch = hop.wander(m, view(), undefined);
	expect(launch.drive.jump).toBe(true);

	let memory = launch.memory;
	for (let i = 0; i < SHAPE.rest.patrol; i++) {
		const step = hop.wander(m, view(), memory);
		expect(step.drive.jump).toBe(false);
		expect(step.drive.moveX).toBe(0);
		memory = step.memory;
	}
	expect(hop.wander(m, view(), memory).drive.jump).toBe(true);
});

test('an open stretch buys a full-stride hop', () => {
	const step = hop.wander(grounded(50), view(), undefined);
	expect(step.drive.moveX).toBe(1);
	expect(step.drive.moveScale).toBeCloseTo(SHAPE.speed, 5);
	expect(step.drive.jumpScale).toBeCloseTo(SHAPE.jump, 5);
});

test('the hop is scaled to the ground that can catch it: a short shelf shortens it', () => {
	const shelf = islandTerrain(60, 8);
	const open = hop.wander(grounded(10), view(), undefined);
	const m = grounded(1);
	m.facing = 1;
	const shuffle = hop.wander(m, view(shelf), undefined);
	expect(shuffle.drive.jump).toBe(true);
	expect(shuffle.drive.moveScale ?? 0).toBeGreaterThan(0);
	expect(shuffle.drive.moveScale ?? 0).toBeLessThan(open.drive.moveScale ?? 0);
});

test('a patrol turns away from a ledge rather than hopping off it', () => {
	const island = islandTerrain();
	const m = grounded(29);
	m.facing = 1;
	expect(hop.wander(m, view(island), undefined).drive.moveX).toBe(-1);
});

test('boxed in the gait hops in place: shortened, never frozen', () => {
	const m = grounded(10);
	// Walls flush against both edges of the slime's own box, whatever derives.
	const box = cellTerrain(
		Math.floor(m.x) - 1,
		Math.ceil(m.x + boxOf('slime').w),
	);
	const step = hop.wander(m, view(box), undefined);
	expect(step.drive.jump).toBe(true);
	expect(step.drive.moveScale).toBe(0);
	expect(step.drive.moveX).toBe(0);
});

test('in flight the gait holds its heading and the scale it launched with', () => {
	const m = airborne(50);
	m.facing = -1;
	const launched = hop.wander(grounded(50), view(), undefined);
	const step = hop.wander(m, view(), launched.memory);
	expect(step.drive.jump).toBe(false);
	expect(step.drive.moveX).toBe(-1);
	expect(step.drive.moveScale).toBeCloseTo(launched.drive.moveScale ?? 0, 5);
});

test('approach hops close the distance left, capped at a full stride', () => {
	const m = grounded(50);
	const far = hop.moveToward(m, view(), m.x - 40, undefined);
	const near = hop.moveToward(m, view(), m.x - 1, undefined);
	expect(far.drive.moveX).toBe(-1);
	expect(far.drive.moveScale).toBeCloseTo(SHAPE.speed, 5);
	expect(near.drive.jump).toBe(true);
	expect(near.drive.moveScale ?? 0).toBeLessThan(SHAPE.speed);
	expect(near.drive.moveScale ?? 0).toBeGreaterThan(0);
});

test('at the destination the gait stands still', () => {
	const m = grounded(50);
	const step = hop.moveToward(m, view(), m.x, undefined);
	expect(step.drive.jump).toBe(false);
	expect(step.drive.moveX).toBe(0);
});

test('an approach rest paces the chase', () => {
	const m = grounded(50);
	const launch = hop.moveToward(m, view(), m.x - 40, undefined);
	expect(launch.drive.jump).toBe(true);

	let memory = launch.memory;
	for (let i = 0; i < SHAPE.rest.approach; i++) {
		const step = hop.moveToward(m, view(), m.x - 40, memory);
		expect(step.drive.jump).toBe(false);
		expect(step.drive.moveX).toBe(0);
		memory = step.memory;
	}
	expect(hop.moveToward(m, view(), m.x - 40, memory).drive.jump).toBe(true);
});

test('a patrol rest does not pace a chase: the gait moves off at once', () => {
	const m = grounded(50);
	const resting = hop.wander(m, view(), undefined).memory;
	const step = hop.moveToward(m, view(), m.x - 40, resting);
	expect(step.drive.jump).toBe(true);
	expect(step.drive.moveX).toBe(-1);
});

test("a foreign slice is not the gait's: the hop falls back to its rested initial state", () => {
	const foreign: EngineMemory = { kind: 'fire', settling: true };
	const m = grounded(50);
	expect(hop.wander(m, view(), foreign)).toEqual(
		hop.wander(m, view(), undefined),
	);
	expect(hop.moveToward(m, view(), m.x - 40, foreign)).toEqual(
		hop.moveToward(m, view(), m.x - 40, undefined),
	);
});
