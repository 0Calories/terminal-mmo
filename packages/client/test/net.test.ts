import { expect, test } from 'bun:test';
import { ACTION_FLAG, IDLE_ACTION } from '@mmo/core/combat';
import { BOX, spawnAvatar } from '@mmo/core/entities';
import { parseTerrain } from '@mmo/core/physics';
import type { ServerMessage } from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { INTERP_DELAY_MS } from '../src/net/interp';
import { NetClient, snapshotToGame } from '../src/net/net';

const y = GROUND_TOP - BOX.h;
const FIELD_ID = 'test-zone';

const FAKE_IDENTITY = {
	publicKey: 'ssh-ed25519 AAAATEST',
	signChallenge: async () => Uint8Array.of(1, 2, 3),
};

function loadField(): Zone {
	return {
		id: FIELD_ID,
		type: 'field',
		terrain: parseTerrain(
			Array.from({ length: GROUND_TOP + 3 }, (_, row) =>
				(row >= GROUND_TOP ? '#' : '.').repeat(80),
			),
		),
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		nextMonsterId: 1,
		portals: [],
	};
}

function snapshot(): Extract<ServerMessage, { t: 'snapshot' }> {
	return {
		t: 'snapshot',
		tick: 12,
		zoneId: FIELD_ID,
		avatars: [
			{
				sessionId: 1,
				handle: 'me',
				cosmetics: { hue: 2, hat: 'cap', nameplate: 4, form: 'buddy' },
				x: 40,
				y,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 50,
				maxHp: 80,
				hurtT: 0,
				weapon: 0,
				action: IDLE_ACTION,
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
				action: IDLE_ACTION,
			},
		],
		projectiles: [
			{
				id: 2,
				x: 55,
				y,
				vx: -36,
				vy: 0,
				life: 2,
				damage: 7,
				poiseDamage: 6,
				knockback: 30,
				knockbackUp: 10,
			},
		],
		events: [],
		drops: [],
		progress: { level: 4, xp: 30, gold: 11 },
		inventory: [],
		log: ['Looted rare Iron Sword.'],
	};
}

function withOther(): Extract<ServerMessage, { t: 'snapshot' }> {
	const s = snapshot();
	s.avatars.push({
		sessionId: 2,
		handle: 'rival',
		cosmetics: { hue: 5, hat: 'crown', nameplate: 6, form: 'buddy' },
		x: 70,
		y,
		vx: 0,
		vy: 0,
		facing: -1,
		onGround: true,
		hp: 30,
		maxHp: 80,
		hurtT: 0.5,
		weapon: 2,
		action: IDLE_ACTION,
	});
	return s;
}

test('snapshot conversion combines predicted ownership with authoritative shared state', () => {
	const field = loadField();
	const s = withOther();
	s.avatars[1].action = {
		move: 'idle',
		phase: 'recovery',
		progress: 0,
		flags: ACTION_FLAG.guarding,
		emote: null,
		emoteT: 0,
	};
	const predicted = { ...spawnAvatar(33, y), facing: -1 as const };
	const game = snapshotToGame(field, predicted, 1, s, {});
	const other = game.others?.[0];
	const zone = game.world.zones[FIELD_ID];

	expect(game.player.avatar.x).toBe(33);
	expect(game.player.avatar.facing).toBe(-1);
	expect(game.player.avatar.cosmetics).toEqual(s.avatars[0].cosmetics);
	expect(game.player.avatar.weapon).toBe(s.avatars[0].weapon);
	expect(game.player.progress).toEqual({ level: 4, xp: 30, gold: 11 });
	expect(other).toMatchObject({
		type: 'player',
		name: 'rival',
		x: 70,
		facing: -1,
		hp: 30,
		hurtT: 0.5,
		cosmetics: s.avatars[1].cosmetics,
		weapon: s.avatars[1].weapon,
	});
	expect(other?.action?.flags).toBe(ACTION_FLAG.guarding);
	expect(zone.monsters.length).toBe(1);
	expect(zone.projectiles.length).toBe(1);
	expect(game.world.tick).toBe(12);
});

test('snapshotToGame degrades gracefully before the first snapshot', () => {
	const field = loadField();
	const game = snapshotToGame(field, spawnAvatar(10, y), 1, null, {});
	expect(game.world.zones[FIELD_ID].monsters.length).toBe(0);
	expect(game.player.progress.level).toBe(1);
	expect(game.others).toEqual([]);
});

function snapAt(x: number): Extract<ServerMessage, { t: 'snapshot' }> {
	const s = snapshot();
	s.avatars[0].x = x;
	return s;
}

test('NetClient samples co-present motion interpolated INTERP_DELAY_MS in the past', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest(snapAt(40), 1000);
	net.ingest(snapAt(60), 1050);

	const view = net.sample(1025 + INTERP_DELAY_MS);
	expect(view?.avatars[0].x).toBe(50);
	net.close();
});

test('NetClient.sample is null until the first snapshot arrives', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	expect(net.sample(1000)).toBe(null);
	net.close();
});

test('a Zone change discards interpolation history from the prior Zone', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest(snapAt(40), 1000);
	const arrived = snapAt(12);
	arrived.zoneId = 'new-zone';
	net.ingest(arrived, 1050);

	expect(net.zoneId).toBe('new-zone');
	expect(net.sample(1025 + INTERP_DELAY_MS)).toMatchObject({
		zoneId: 'new-zone',
		avatars: [expect.objectContaining({ x: 12 })],
	});
	net.close();
});

test('NetClient surfaces create rejection without closing', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	const reasons: Array<'taken' | 'invalid'> = [];
	net.onCreateRejected = (reason) => reasons.push(reason);
	net.ingest({ t: 'createRejected', reason: 'taken' }, 1000);
	net.ingest({ t: 'createRejected', reason: 'invalid' }, 1010);
	expect(reasons).toEqual(['taken', 'invalid']);
	expect(net.rejected).toBe(null);
	net.close();
});

test('NetClient.chatLog is bounded so it cannot grow without limit', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	for (let i = 0; i < 200; i++)
		net.ingest(
			{ t: 'chat', sessionId: 3, handle: 'spammer', text: `msg ${i}` },
			1000 + i,
		);
	expect(net.chatLog.length).toBeLessThan(200);
	expect(net.chatLog.at(-1)).toBe('spammer: msg 199');
	net.close();
});

test('NetClient.ingest surfaces a server notice as a system line', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest({ t: 'notice', text: 'No player named "ghost" is online.' }, 1000);
	expect(net.chatLog).toEqual(['* No player named "ghost" is online.']);
	net.close();
});

test('NetClient.notice surfaces a local system line without a round-trip', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.notice('Usage: /w <handle> <message>');
	expect(net.chatLog).toEqual(['* Usage: /w <handle> <message>']);
	net.close();
});

test('NetClient.decayBubbles expires a bubble after its length-scaled ttl', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest({ t: 'chat', sessionId: 5, handle: 'neo', text: 'gg' }, 1000);

	net.decayBubbles(2);
	expect(net.bubbles.has(5)).toBe(true);
	net.decayBubbles(2);
	expect(net.bubbles.has(5)).toBe(false);
	net.close();
});

test('snapshotToGame stamps active bubbles onto the sender entities, incl. own', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const bubbles = new Map([
		[1, { text: 'mine', ttl: 3 }],
		[2, { text: 'theirs', ttl: 3 }],
	]);
	const game = snapshotToGame(field, predicted, 1, withOther(), {}, bubbles);
	expect(game.player.avatar.bubble).toBe('mine');
	expect(game.others?.[0]?.bubble).toBe('theirs');
});

test('NetClient hands a challenge nonce to the identity signer', async () => {
	const saw: { nonce: Uint8Array | null } = { nonce: null };
	const identity = {
		publicKey: 'ssh-ed25519 AAAATEST',
		signChallenge: async (nonce: Uint8Array) => {
			saw.nonce = nonce;
			return Uint8Array.of(9);
		},
	};
	const net = new NetClient('ws://127.0.0.1:1', 'tester', identity);
	const nonce = Uint8Array.of(4, 5, 6);
	net.ingest({ t: 'challenge', nonce }, 0);
	await Promise.resolve();
	expect(saw.nonce).toEqual(nonce);
	net.close();
});

test('NetClient surfaces a signer failure as a rejection', async () => {
	const saw: { reason: string | null } = { reason: null };
	const identity = {
		publicKey: 'ssh-ed25519 AAAATEST',
		signChallenge: async () => {
			throw new Error('ssh-agent refused to sign');
		},
	};
	const net = new NetClient('ws://127.0.0.1:1', 'tester', identity, (r) => {
		saw.reason = r;
	});
	net.ingest({ t: 'challenge', nonce: Uint8Array.of(1) }, 0);

	await Promise.resolve();
	await Promise.resolve();
	expect(saw.reason).toBe('ssh-agent refused to sign');
	expect(net.rejected).toBe('ssh-agent refused to sign');
	net.close();
});
