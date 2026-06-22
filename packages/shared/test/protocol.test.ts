import { expect, test } from 'bun:test';
import type { ClientMessage, ServerMessage } from '../src';
import {
	decodeClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	encodeServerMessage,
	PROTOCOL_VERSION,
} from '../src';

test('hello round-trips the handle + protocol version', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		protocol: PROTOCOL_VERSION,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a legacy hello (no protocol field) decodes to protocol 0', () => {
	// Hand-roll a pre-0009 hello: tag(1) + u32 length-prefixed handle, no version.
	const handle = new TextEncoder().encode('legacy');
	const buf = new Uint8Array(1 + 4 + handle.length);
	buf[0] = 1; // CLIENT_TAG.hello
	new DataView(buf.buffer).setUint32(1, handle.length);
	buf.set(handle, 5);
	expect(decodeClientMessage(buf)).toEqual({
		t: 'hello',
		handle: 'legacy',
		protocol: 0,
	});
});

test('input round-trips reported kinematics + combat intents', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 12.5,
		y: 31.25,
		vx: -22,
		vy: 7.5,
		facing: -1,
		onGround: true,
		attack: true,
		interact: false,
		skill: 1,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('input round-trips with no skill intent', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: false,
		attack: false,
		interact: false,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('input round-trips the interact (portal) intent', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 24,
		y: 30,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		interact: true,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('chat (client -> server) round-trips the message text', () => {
	const msg: ClientMessage = { t: 'chat', text: 'hello field 👋' };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('whisper (client -> server) round-trips the target handle + text', () => {
	const msg: ClientMessage = {
		t: 'whisper',
		to: 'Trinity',
		text: 'meet me 🐇',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('whisper (server -> client) round-trips sender session + both handles + text', () => {
	const msg: ServerMessage = {
		t: 'whisper',
		fromSessionId: 7,
		from: 'neo',
		to: 'trinity',
		text: 'follow the white rabbit',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('notice (server -> client) round-trips the sender-only system line', () => {
	const msg: ServerMessage = {
		t: 'notice',
		text: 'No player named "ghost" is online.',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('welcome round-trips the assigned session, zone, and tick rate', () => {
	const msg: ServerMessage = {
		t: 'welcome',
		sessionId: 7,
		zoneId: 'field-01',
		tickRate: 20,
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('chat (server -> client) round-trips the sender session, handle, and text', () => {
	const msg: ServerMessage = {
		t: 'chat',
		sessionId: 42,
		handle: 'neo',
		text: 'gg wp',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('snapshot round-trips authoritative zone state + owner-private fields', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 1234,
		zoneId: 'field-01',
		avatars: [
			{
				sessionId: 7,
				handle: 'neo',
				x: 12.5,
				y: 31.25,
				vx: -22,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 80,
				maxHp: 92,
				hurtT: 0.3,
			},
		],
		monsters: [
			{
				id: 3,
				type: 'shooter',
				x: 50,
				y: 32,
				vx: 0,
				vy: 1.5,
				facing: -1,
				onGround: false,
				hp: 10,
				maxHp: 16,
				hurtT: 0,
			},
		],
		projectiles: [
			{ id: 9, x: 48, y: 33, vx: -36, vy: 0, life: 2.4, damage: 7, ownerId: 3 },
		],
		progress: { level: 3, xp: 17, gold: 42 },
		inventory: [
			{
				id: 1,
				base: 'Iron Sword',
				slot: 'weapon',
				rarity: 'rare',
				affixes: [
					{ stat: 'str', value: 4 },
					{ stat: 'crit', value: 2 },
				],
			},
		],
		log: ['Looted rare Iron Sword.', 'Level up! Now level 3.'],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('reject round-trips the human-readable reason', () => {
	const msg: ServerMessage = {
		t: 'reject',
		reason: 'client out of date',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('snapshot round-trips when the zone is empty', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 0,
		zoneId: 'town-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});
