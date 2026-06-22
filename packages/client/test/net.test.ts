import { expect, test } from 'bun:test';
import {
	BOX,
	GROUND_TOP,
	loadZones,
	type ServerMessage,
	spawnAvatar,
	type Zone,
} from '@mmo/shared';
import { INTERP_DELAY_MS } from '../src/interp';
import { NetClient, snapshotToGame } from '../src/net';

const y = GROUND_TOP - BOX.h;

// The authored Field, parsed (ADR 0008) — snapshotToGame needs a Zone's local
// geometry; the snapshot supplies the live entities.
function loadField(): Zone {
	const field = loadZones().find((z) => z.id === 'field-01');
	if (!field) throw new Error('field-01 missing from authored zones/');
	return field;
}

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
	const field = loadField();
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
	const field = loadField();
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
	const field = loadField();
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

test('NetClient.ingest collects chat lines attributed to the sender handle', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest(
		{ t: 'chat', sessionId: 1, handle: 'neo', text: 'hi field' },
		1000,
	);
	net.ingest({ t: 'chat', sessionId: 2, handle: 'trinity', text: 'hey' }, 1010);
	expect(net.chatLog).toEqual(['neo: hi field', 'trinity: hey']);
	net.close();
});

test('NetClient.chatLog is bounded so it cannot grow without limit', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	for (let i = 0; i < 200; i++)
		net.ingest(
			{ t: 'chat', sessionId: 3, handle: 'spammer', text: `msg ${i}` },
			1000 + i,
		);
	expect(net.chatLog.length).toBeLessThanOrEqual(100);
	// the most recent line is retained
	expect(net.chatLog.at(-1)).toBe('spammer: msg 199');
	net.close();
});

test('NetClient.ingest renders a whisper distinctly by direction (#40)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.sessionId = 7; // this client
	// Incoming: another session whispered us.
	net.ingest(
		{ t: 'whisper', fromSessionId: 9, from: 'neo', to: 'tester', text: 'hi' },
		1000,
	);
	// Outgoing echo: our own whisper, returned by the server.
	net.ingest(
		{ t: 'whisper', fromSessionId: 7, from: 'tester', to: 'neo', text: 'yo' },
		1010,
	);
	expect(net.chatLog).toEqual(['[neo → you] hi', '[you → neo] yo']);
	net.close();
});

test('NetClient.ingest does NOT open a Speech bubble for a private whisper', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.sessionId = 7;
	net.ingest(
		{ t: 'whisper', fromSessionId: 9, from: 'neo', to: 'tester', text: 'psst' },
		1000,
	);
	expect(net.bubbles.size).toBe(0); // whispers are private — no over-head bubble
	net.close();
});

test('NetClient.ingest surfaces a server notice as a system line', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'notice', text: 'No player named "ghost" is online.' }, 1000);
	expect(net.chatLog).toEqual(['* No player named "ghost" is online.']);
	net.close();
});

test('NetClient.notice surfaces a local system line without a round-trip', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.notice('Usage: /w <handle> <message>');
	expect(net.chatLog).toEqual(['* Usage: /w <handle> <message>']);
	net.close();
});

test('NetClient.ingest opens a Speech bubble keyed to the sender, replacing the prior one', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'chat', sessionId: 2, handle: 'rival', text: 'hi' }, 1000);
	expect(net.bubbles.get(2)?.text).toBe('hi');
	// A new message from the same sender replaces the text (one bubble per sender).
	net.ingest({ t: 'chat', sessionId: 2, handle: 'rival', text: 'bye' }, 1100);
	expect(net.bubbles.get(2)?.text).toBe('bye');
	expect(net.bubbles.size).toBe(1);
	net.close();
});

test('NetClient.decayBubbles expires a bubble after its length-scaled ttl', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'chat', sessionId: 5, handle: 'neo', text: 'gg' }, 1000);
	net.decayBubbles(2); // 2s elapsed, ttl floor is 3s -> still alive
	expect(net.bubbles.has(5)).toBe(true);
	net.decayBubbles(2); // 4s total -> expired
	expect(net.bubbles.has(5)).toBe(false);
	net.close();
});

test('NetClient.ingest opens an emote keyed to the sender (#38)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'emote', sessionId: 2, emote: 'wave' }, 1000);
	expect(net.emotes.get(2)?.id).toBe('wave');
	// A new emote from the same sender replaces the prior one (one per sender).
	net.ingest({ t: 'emote', sessionId: 2, emote: 'laugh' }, 1100);
	expect(net.emotes.get(2)?.id).toBe('laugh');
	expect(net.emotes.size).toBe(1);
	net.close();
});

test('NetClient.ingest ignores an unknown emote id (#38)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'emote', sessionId: 3, emote: 'bogus' }, 1000);
	expect(net.emotes.size).toBe(0);
	net.close();
});

test('NetClient.ingest does NOT push an emote into the chat log (#38)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'emote', sessionId: 2, emote: 'wave' }, 1000);
	expect(net.chatLog).toEqual([]); // emotes are visual, not chat lines
	net.close();
});

test('NetClient.decayEmotes expires an emote after EMOTE_TTL (#38)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester');
	net.ingest({ t: 'emote', sessionId: 5, emote: 'dance' }, 1000);
	net.decayEmotes(2); // 2s elapsed, ttl is 2.5s -> still alive
	expect(net.emotes.has(5)).toBe(true);
	net.decayEmotes(1); // 3s total -> expired
	expect(net.emotes.has(5)).toBe(false);
	net.close();
});

test('snapshotToGame stamps active emotes onto the sender entities, incl. own (#38)', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const emotes = new Map([
		[1, { id: 'wave', ttl: 2 }],
		[2, { id: 'laugh', ttl: 2 }],
	]);
	const game = snapshotToGame(
		field,
		predicted,
		1,
		withOther(),
		{},
		new Map(),
		emotes,
	);
	expect(game.player.avatar.emote).toBe('wave');
	expect(game.others?.[0]?.emote).toBe('laugh');
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
