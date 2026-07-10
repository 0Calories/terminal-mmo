import { expect, test } from 'bun:test';
import type { Control, Entity, Terrain } from '../../src/entities';
import { BOX, spawnAvatar } from '../../src/entities';
import { applyImpulse, parseTerrain, stepEntity } from '../../src/physics';
import { spawnMonster } from '../../src/world';

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
const COL = '........#...';
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
// One-way platform (`=`) at row 8, x=2..7; ground floor at rows 18-19.
const PLATFORM = parseTerrain([
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'............',
	'..======....',
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
	expect(e.x + BOX.w).toBeLessThanOrEqual(8);
	expect(e.x).toBeGreaterThan(1);
});

test('jump: leaves the ground with upward velocity', () => {
	const grounded = settle(FLAT, spawnAvatar(2, 0));
	expect(grounded.onGround).toBe(true);
	const jumped = stepEntity(FLAT, grounded, { moveX: 0, jump: true }, 1 / 60).e;
	expect(jumped.vy).toBeLessThan(0);
	expect(jumped.onGround).toBe(false);
});

test('one-way platform: rising through a platform passes through (no head bonk)', () => {
	const grounded = settle(PLATFORM, spawnAvatar(3, 13));
	expect(grounded.onGround).toBe(true);
	let e = stepEntity(PLATFORM, grounded, { moveX: 0, jump: true }, 1 / 60).e;
	let minY = e.y;
	for (let i = 0; i < 120 && !(i > 0 && e.onGround); i++) {
		e = stepEntity(PLATFORM, e, IDLE, 1 / 60).e;
		minY = Math.min(minY, e.y);
	}
	expect(minY).toBeLessThan(8);
});

test('one-way platform: descending from above lands on top', () => {
	const e = settle(PLATFORM, spawnAvatar(3, 0));
	expect(e.onGround).toBe(true);
	expect(e.y).toBeCloseTo(8 - BOX.h, 5);
});

test('one-way platform: came-from-below never snaps up (no teleport glitch)', () => {
	const grounded = settle(PLATFORM, spawnAvatar(3, 13));
	let e = stepEntity(PLATFORM, grounded, { moveX: 0, jump: true }, 1 / 60).e;
	e = settle(PLATFORM, e);
	expect(e.onGround).toBe(true);
	expect(e.y).toBeCloseTo(grounded.y, 5);
});

test('one-way platform: descending with feet below the surface does not land', () => {
	const straddling: Entity = { ...spawnAvatar(3, 3.5), vy: 2, onGround: false };
	const e = stepEntity(PLATFORM, straddling, IDLE, 1 / 60).e;
	expect(e.onGround).toBe(false);
	expect(e.y).toBeGreaterThan(3.5);
});

test('one-way platform: horizontal movement is preserved while rising through it (#262 halt regression)', () => {
	const ground = '#'.repeat(40);
	const PLATFORM_WIDE = parseTerrain([
		...Array(8).fill('.'.repeat(40)),
		`.....${'='.repeat(16)}${'.'.repeat(19)}`,
		...Array(9).fill('.'.repeat(40)),
		ground,
		ground,
	]);
	const grounded = settle(PLATFORM_WIDE, spawnAvatar(6, 13));
	expect(grounded.onGround).toBe(true);

	let e = stepEntity(
		PLATFORM_WIDE,
		grounded,
		{ moveX: 1, jump: true },
		1 / 60,
	).e;
	let minY = e.y;
	let prevX = e.x;
	for (let i = 0; i < 120 && !e.onGround; i++) {
		e = stepEntity(PLATFORM_WIDE, e, { moveX: 1, jump: false }, 1 / 60).e;
		expect(e.x).toBeGreaterThan(prevX);
		prevX = e.x;
		minY = Math.min(minY, e.y);
	}
	expect(minY).toBeLessThan(8);
});

test('parity: with no impulse, a settled idle body never gains horizontal drift', () => {
	const e = settle(WIDE, spawnAvatar(20, 0));
	expect(e.ivx ?? 0).toBe(0);
	expect(e.vx).toBe(0);
	const next = stepEntity(WIDE, e, IDLE, 1 / 60).e;
	expect(next.x).toBe(e.x);
	expect(next.vx).toBe(0);
});

test('impulse: a horizontal shove moves a body and decays under drag', () => {
	const grounded = settle(WIDE, spawnAvatar(20, 0));
	let e = applyImpulse(grounded, 60, 0);
	expect(e.ivx).toBeGreaterThan(0);
	const startX = e.x;
	let prevSpeed = Math.abs(e.ivx ?? 0);
	for (let i = 0; i < 120; i++) {
		e = stepEntity(WIDE, e, IDLE, 1 / 60).e;
		const speed = Math.abs(e.ivx ?? 0);
		expect(speed).toBeLessThanOrEqual(prevSpeed);
		prevSpeed = speed;
	}
	expect(e.x).toBeGreaterThan(startX);
	expect(e.ivx ?? 0).toBe(0);
});

test('impulse: an up-and-out shove arcs — rises under the launch, falls under gravity', () => {
	const grounded = settle(WIDE, spawnAvatar(20, 0));
	let e = applyImpulse(grounded, 30, -40);
	expect(e.vy).toBeLessThan(0);
	const startX = e.x;
	let minY = e.y;
	for (let i = 0; i < 200 && !(i > 0 && e.onGround); i++) {
		e = stepEntity(WIDE, e, IDLE, 1 / 60).e;
		minY = Math.min(minY, e.y);
	}
	expect(minY).toBeLessThan(grounded.y);
	expect(e.onGround).toBe(true);
	expect(e.x).toBeGreaterThan(startX);
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
	let e = applyImpulse(grounded, 200, 0);
	for (let i = 0; i < 20; i++) e = stepEntity(WALL, e, IDLE, 1 / 60).e;
	expect(e.x + BOX.w).toBeLessThanOrEqual(8);
	expect(e.ivx ?? 0).toBe(0);
});

test('airborne monster: integrates gravity on the shared body and lands', () => {
	const m = spawnMonster('chaser', 2, 20, 0);
	let e = stepEntity(WIDE, m, { moveX: 0, jump: false }, 1 / 60).e;
	expect(e.onGround).toBe(false);
	e = settle(WIDE, e, { moveX: 0, jump: false });
	expect(e.onGround).toBe(true);
	expect(e.vy).toBe(0);
});
