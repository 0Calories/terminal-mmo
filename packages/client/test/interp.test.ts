import { expect, test } from 'bun:test';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from '@mmo/shared';
import { IDLE_ACTION } from '@mmo/shared';
import { SnapshotBuffer } from '../src/interp';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

function avatar(sessionId: number, x: number, y: number): AvatarSnapshot {
	return {
		sessionId,
		handle: 'p',
		cosmetics: { hue: 0, hat: 0, nameplate: 0 },
		x,
		y,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		hp: 80,
		maxHp: 80,
		hurtT: 0,
		weapon: 0,
		action: IDLE_ACTION,
	};
}

function monster(id: number, x: number, y: number): MonsterSnapshot {
	return {
		id,
		type: 'chaser',
		x,
		y,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		hp: 24,
		maxHp: 24,
		hurtT: 0,
		action: IDLE_ACTION,
	};
}

function snap(
	tick: number,
	avatars: AvatarSnapshot[],
	monsters: MonsterSnapshot[] = [],
): Snapshot {
	return {
		t: 'snapshot',
		tick,
		zoneId: 'field-01',
		avatars,
		monsters,
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
	};
}

test('an empty buffer samples to null', () => {
	const buf = new SnapshotBuffer();
	expect(buf.sample(0)).toBeNull();
});

test('a single snapshot is returned unchanged at any render time', () => {
	const buf = new SnapshotBuffer();
	const only = snap(1, [avatar(7, 40, 12)]);
	buf.push(only, 1000);
	expect(buf.sample(500)?.avatars[0].x).toBe(40);
	expect(buf.sample(1000)?.avatars[0].x).toBe(40);
	expect(buf.sample(5000)?.avatars[0].x).toBe(40);
});

test("an avatar's position lerps between the two bracketing snapshots", () => {
	const buf = new SnapshotBuffer();
	buf.push(snap(1, [avatar(7, 40, 10)]), 1000);
	buf.push(snap(2, [avatar(7, 60, 30)]), 1050);
	// halfway through the 1000->1050 interval
	const mid = buf.sample(1025);
	expect(mid?.avatars[0].x).toBe(50);
	expect(mid?.avatars[0].y).toBe(20);
	// a quarter of the way
	const quarter = buf.sample(1012.5);
	expect(quarter?.avatars[0].x).toBe(45);
	expect(quarter?.avatars[0].y).toBe(15);
});

test('a monster lerps by id between bracketing snapshots', () => {
	const buf = new SnapshotBuffer();
	buf.push(snap(1, [], [monster(3, 100, 20)]), 1000);
	buf.push(snap(2, [], [monster(3, 140, 20)]), 1050);
	const mid = buf.sample(1025);
	expect(mid?.monsters[0].x).toBe(120);
});

test('discrete and private fields come from the newer bracket, not lerped', () => {
	const buf = new SnapshotBuffer();
	const a1 = { ...avatar(7, 40, 10), facing: 1 as const, hp: 80 };
	const a2 = { ...avatar(7, 60, 10), facing: -1 as const, hp: 50 };
	const older = snap(1, [a1]);
	const newer: ReturnType<typeof snap> = {
		...snap(2, [a2]),
		projectiles: [
			{ id: 9, x: 70, y: 10, vx: -36, vy: 0, life: 2, damage: 7, ownerId: 3 },
		],
		progress: { level: 4, xp: 30, gold: 11 },
		log: ['Level up!'],
	};
	buf.push(older, 1000);
	buf.push(newer, 1050);
	const mid = buf.sample(1025);
	// position eased, but facing/hp snap to the newer authoritative value
	expect(mid?.avatars[0].x).toBe(50);
	expect(mid?.avatars[0].facing).toBe(-1);
	expect(mid?.avatars[0].hp).toBe(50);
	// private/non-positional state is taken wholesale from the newer snapshot
	expect(mid?.projectiles.length).toBe(1);
	expect(mid?.progress).toEqual({ level: 4, xp: 30, gold: 11 });
	expect(mid?.log).toEqual(['Level up!']);
	expect(mid?.tick).toBe(2);
});

test('the roster follows the newer snapshot: joiners appear, leavers drop', () => {
	const buf = new SnapshotBuffer();
	// session 7 is present throughout; 8 leaves; 9 joins in the newer snapshot.
	buf.push(snap(1, [avatar(7, 40, 10), avatar(8, 90, 10)]), 1000);
	buf.push(snap(2, [avatar(7, 60, 10), avatar(9, 20, 10)]), 1050);
	const mid = buf.sample(1025);
	const ids = mid?.avatars.map((a) => a.sessionId).sort();
	expect(ids).toEqual([7, 9]);
	// the joiner has no prior position, so it shows at its newer position (no lerp)
	expect(mid?.avatars.find((a) => a.sessionId === 9)?.x).toBe(20);
	// the survivor still eases from its old position
	expect(mid?.avatars.find((a) => a.sessionId === 7)?.x).toBe(50);
});

test('the buffer prunes stale frames so a long session stays bounded', () => {
	const buf = new SnapshotBuffer();
	// 200 snapshots, 50 ms apart == 10 s of play; far more than the interp window.
	for (let i = 0; i <= 200; i++) buf.push(snap(i, [avatar(7, i, 0)]), i * 50);
	expect(buf.size).toBeLessThanOrEqual(40);
	expect(buf.size).toBeGreaterThanOrEqual(2);
	// recent render times still bracket and interpolate correctly
	const newest = 200 * 50; // 10000
	const mid = buf.sample(newest - 25); // between frame 199 (t=9950) and 200 (t=10000)
	expect(mid?.avatars[0].x).toBe(199.5);
});
