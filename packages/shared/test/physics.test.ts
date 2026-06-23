import { expect, test } from 'bun:test';
import type { Control, Entity, Terrain } from '../src';
import {
	applyImpulse,
	BOX,
	parseTerrain,
	spawnAvatar,
	spawnMonster,
	stepEntity,
} from '../src';

const FLAT = parseTerrain([
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'############',
	'############',
]);
const COL = '........#...'; // solid column at x=8
const WALL = parseTerrain([
	COL,
	COL,
	COL,
	COL,
	COL,
	COL,
	COL,
	COL,
	COL,
	COL,
	'############',
	'############',
]);
// A wide flat floor with room to shove a body across without clipping the world
// edge (out-of-bounds cells read as solid).
const open = '.'.repeat(60);
const floor = '#'.repeat(60);
const WIDE = parseTerrain([
	open,
	open,
	open,
	open,
	open,
	open,
	open,
	open,
	open,
	open,
	floor,
	floor,
]);
const IDLE: Control = { moveX: 0, jump: false };

function settle(t: Terrain, e: Entity, ctl: Control = IDLE, n = 240): Entity {
	for (let i = 0; i < n; i++) e = stepEntity(t, e, ctl, 1 / 60).e;
	return e;
}

test('gravity: an entity falls and lands on the ground', () => {
	const e = settle(FLAT, spawnAvatar(2, 0));
	expect(e.onGround).toBe(true);
	expect(e.vy).toBe(0);
});

test('walls: horizontal movement is blocked by a solid column', () => {
	const e = settle(WALL, spawnAvatar(1, 0), { moveX: 1, jump: false });
	expect(e.x + BOX.w).toBeLessThanOrEqual(8); // never overlaps the wall at x=8
	expect(e.x).toBeGreaterThan(1); // but it did move toward it
});

test('jump: leaves the ground with upward velocity', () => {
	const grounded = settle(FLAT, spawnAvatar(2, 0));
	expect(grounded.onGround).toBe(true);
	const jumped = stepEntity(FLAT, grounded, { moveX: 0, jump: true }, 1 / 60).e;
	expect(jumped.vy).toBeLessThan(0);
	expect(jumped.onGround).toBe(false);
});

// --- Momentum body (ADR 0017, #162) -----------------------------------------

test('parity: with no impulse, a settled idle body never gains horizontal drift', () => {
	// The new ivx channel must be inert in normal play: a grounded, input-less
	// body stays put with zero horizontal velocity tick after tick.
	const e = settle(WIDE, spawnAvatar(20, 0));
	expect(e.ivx ?? 0).toBe(0);
	expect(e.vx).toBe(0);
	const next = stepEntity(WIDE, e, IDLE, 1 / 60).e;
	expect(next.x).toBe(e.x);
	expect(next.vx).toBe(0);
});

test('impulse: a horizontal shove moves a body and decays under drag', () => {
	const grounded = settle(WIDE, spawnAvatar(20, 0));
	let e = applyImpulse(grounded, 60, 0); // rightward shove, no input
	expect(e.ivx).toBeGreaterThan(0);
	const startX = e.x;
	let prevSpeed = Math.abs(e.ivx ?? 0);
	for (let i = 0; i < 120; i++) {
		e = stepEntity(WIDE, e, IDLE, 1 / 60).e;
		const speed = Math.abs(e.ivx ?? 0);
		expect(speed).toBeLessThanOrEqual(prevSpeed); // monotonic decay
		prevSpeed = speed;
	}
	expect(e.x).toBeGreaterThan(startX); // it travelled
	expect(e.ivx ?? 0).toBe(0); // and came to rest (snapped to 0)
});

test('impulse: an up-and-out shove arcs — rises under the launch, falls under gravity', () => {
	const grounded = settle(WIDE, spawnAvatar(20, 0));
	let e = applyImpulse(grounded, 30, -40); // up and to the right
	expect(e.vy).toBeLessThan(0); // launched upward
	const startX = e.x;
	let minY = e.y;
	for (let i = 0; i < 200 && !(i > 0 && e.onGround); i++) {
		e = stepEntity(WIDE, e, IDLE, 1 / 60).e;
		minY = Math.min(minY, e.y);
	}
	expect(minY).toBeLessThan(grounded.y); // it rose above the start (smaller y = higher)
	expect(e.onGround).toBe(true); // gravity brought it back down to land
	expect(e.x).toBeGreaterThan(startX); // and it drifted along the horizontal shove
});

test('mass: a heavier body is thrown less far by the same impulse', () => {
	const FAR = { ...spawnAvatar(20, 0), mass: 1 };
	const HEAVY = { ...spawnAvatar(20, 0), mass: 4 };
	let light = applyImpulse(settle(WIDE, FAR), 80, 0);
	let heavy = applyImpulse(settle(WIDE, HEAVY), 80, 0);
	const lx0 = light.x;
	const hx0 = heavy.x;
	for (let i = 0; i < 40; i++) {
		light = stepEntity(WIDE, light, IDLE, 1 / 60).e;
		heavy = stepEntity(WIDE, heavy, IDLE, 1 / 60).e;
	}
	expect(heavy.x - hx0).toBeLessThan(light.x - lx0);
});

test('impulse: a shove into a wall is absorbed, not stored', () => {
	const grounded = settle(WALL, spawnAvatar(1, 0));
	let e = applyImpulse(grounded, 200, 0); // hard shove toward the wall at x=8
	for (let i = 0; i < 20; i++) e = stepEntity(WALL, e, IDLE, 1 / 60).e;
	expect(e.x + BOX.w).toBeLessThanOrEqual(8); // stopped at the wall
	expect(e.ivx ?? 0).toBe(0); // the wall ate the residual impulse
});

test('airborne monster: integrates gravity on the shared body and lands', () => {
	const m = spawnMonster('chaser', 2, 20, 0);
	let e = stepEntity(WIDE, m, { moveX: 0, jump: false }, 1 / 60).e;
	expect(e.onGround).toBe(false); // spawned mid-air, falling
	e = settle(WIDE, e, { moveX: 0, jump: false });
	expect(e.onGround).toBe(true); // fell and landed, no Monster special-casing
	expect(e.vy).toBe(0);
});
