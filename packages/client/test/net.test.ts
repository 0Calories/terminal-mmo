import { expect, test } from 'bun:test';
import {
	BOX,
	GROUND_TOP,
	makeFieldZone,
	type ServerMessage,
	spawnAvatar,
} from '@mmo/shared';
import { INTERP_DELAY_MS } from '../src/interp';
import { NetClient, snapshotToGame } from '../src/net';

const y = GROUND_TOP - BOX.h;

function snapshot(): Extract<ServerMessage, { t: 'snapshot' }> {
	return {
		t: 'snapshot',
		tick: 12,
		zoneId: 'field-01',
		avatars: [
			{
				sessionId: 1,
				handle: 'me',
				x: 40,
				y,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 50,
				maxHp: 80,
				hurtT: 0,
			},
		],
		monsters: [
			{
				id: 5,
				type: 'chaser',
				x: 60,
				y,
				vx: 0,
				vy: 0,
				facing: -1,
				onGround: true,
				hp: 12,
				maxHp: 24,
				hurtT: 0,
			},
		],
		projectiles: [
			{ id: 2, x: 55, y, vx: -36, vy: 0, life: 2, damage: 7, ownerId: 9 },
		],
		progress: { level: 4, xp: 30, gold: 11 },
		inventory: [],
		log: ['Looted rare Iron Sword.'],
	};
}

// A second co-present Avatar (sessionId 2) sharing the Zone with the own one.
function withOther(): Extract<ServerMessage, { t: 'snapshot' }> {
	const s = snapshot();
	s.avatars.push({
		sessionId: 2,
		handle: 'rival',
		x: 70,
		y,
		vx: 0,
		vy: 0,
		facing: -1,
		onGround: true,
		hp: 30,
		maxHp: 80,
		hurtT: 0.5,
	});
	return s;
}

test('snapshotToGame carries co-present Avatars into others, excluding own', () => {
	const field = makeFieldZone('field-01');
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	expect(game.others?.length).toBe(1);
	const other = game.others?.[0];
	expect(other?.type).toBe('player');
	expect(other?.name).toBe('rival'); // handle threaded through for the nameplate
	expect(other?.x).toBe(70);
	expect(other?.facing).toBe(-1);
	expect(other?.hp).toBe(30);
	expect(other?.hurtT).toBe(0.5);
});

test('snapshotToGame renders snapshot monsters/projectiles with the predicted own Avatar', () => {
	const field = makeFieldZone('field-01');
	const predicted = { ...spawnAvatar(33, y), facing: -1 as const };
	const game = snapshotToGame(field, predicted, 1, snapshot(), {});
	const zone = game.world.zones['field-01'];
	// own Avatar position comes from local prediction, not the snapshot
	expect(game.player.avatar.x).toBe(33);
	expect(game.player.avatar.facing).toBe(-1);
	// progress/log/zone entities come from the server snapshot
	expect(game.player.progress).toEqual({ level: 4, xp: 30, gold: 11 });
	expect(zone.monsters.length).toBe(1);
	expect(zone.monsters[0].type).toBe('chaser');
	expect(zone.projectiles.length).toBe(1);
	expect(game.world.tick).toBe(12);
	// the lone avatar in the snapshot is our own, so no co-present others
	expect(game.others).toEqual([]);
});

test('snapshotToGame degrades gracefully before the first snapshot', () => {
	const field = makeFieldZone('field-01');
	const game = snapshotToGame(field, spawnAvatar(10, y), 1, null, {});
	expect(game.world.zones['field-01'].monsters.length).toBe(0);
	expect(game.player.progress.level).toBe(1);
	expect(game.others).toEqual([]);
});

// The same snapshot with avatar 1 placed at a given x, for interpolation tests.
function snapAt(x: number): Extract<ServerMessage, { t: 'snapshot' }> {
	const s = snapshot();
	s.avatars[0].x = x;
	return s;
}

test('NetClient samples co-present motion interpolated INTERP_DELAY_MS in the past', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	// Two 20Hz frames, avatar 1 sliding 40 -> 60 over 50 ms.
	net.ingest(snapAt(40), 1000);
	net.ingest(snapAt(60), 1050);
	// Rendering at now=1125 looks back INTERP_DELAY_MS (100) to t=1025 — halfway
	// between the two frames — so the avatar is eased to the midpoint.
	const view = net.sample(1025 + INTERP_DELAY_MS);
	expect(view?.avatars[0].x).toBe(50);
	net.close();
});

test('NetClient.sample is null until the first snapshot arrives', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	expect(net.sample(1000)).toBe(null);
	net.close();
});

test('NetClient drops the interpolation buffer (and tracks the Zone) on a Zone change', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest(snapAt(40), 1000); // field-01, avatar at x=40
	const town = snapAt(12);
	town.zoneId = 'town-01'; // arrived in a new Zone
	net.ingest(town, 1050);
	expect(net.zoneId).toBe('town-01');
	// No cross-Zone interpolation: sampling midway yields only the new Zone's frame.
	const view = net.sample(1025 + INTERP_DELAY_MS);
	expect(view?.zoneId).toBe('town-01');
	expect(view?.avatars[0].x).toBe(12);
	net.close();
});

test('NetClient.ingest applies the welcome handshake and tracks the latest snapshot', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest(
		{ t: 'welcome', sessionId: 7, zoneId: 'field-01', tickRate: 20 },
		0,
	);
	expect(net.sessionId).toBe(7);
	expect(net.ready).toBe(true);
	net.ingest(snapAt(42), 1000);
	expect(net.latest?.avatars[0].x).toBe(42);
	net.close();
});
