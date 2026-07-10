import { expect, test } from 'bun:test';
import {
	ACTION_FLAG,
	BOX,
	GROUND_TOP,
	IDLE_ACTION,
	loadZones,
	type ServerMessage,
	spawnAvatar,
	type Zone,
} from '@mmo/core';
import { INTERP_DELAY_MS } from '../src/net/interp';
import { NetClient, snapshotToGame } from '../src/net/net';

const y = GROUND_TOP - BOX.h;

const FAKE_IDENTITY = {
	publicKey: 'ssh-ed25519 AAAATEST',
	signChallenge: async () => Uint8Array.of(1, 2, 3),
};

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

test('snapshotToGame carries co-present Avatars into others, excluding own', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	expect(game.others?.length).toBe(1);
	const other = game.others?.[0];
	expect(other?.type).toBe('player');
	expect(other?.name).toBe('rival');
	expect(other?.x).toBe(70);
	expect(other?.facing).toBe(-1);
	expect(other?.hp).toBe(30);
	expect(other?.hurtT).toBe(0.5);
});

test('snapshotToGame threads cosmetics onto co-present Avatars and the own Avatar (#35)', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	expect(game.others?.[0]?.cosmetics).toEqual({
		hue: 5,
		hat: 'crown',
		nameplate: 6,
		form: 'buddy',
	});
	expect(game.player.avatar.cosmetics).toEqual({
		hue: 2,
		hat: 'cap',
		nameplate: 4,
		form: 'buddy',
	});
});

test('snapshotToGame threads the replicated weapon onto co-present + own Avatars (ADR 0017 §14)', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	expect(game.others?.[0]?.weapon).toBe(2);
	expect(game.player.avatar.weapon).toBe(0);
});

test('snapshotToGame threads a co-present Avatar Guard stance onto its entity action (ADR 0017 §5/§10)', () => {
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
	const game = snapshotToGame(field, spawnAvatar(33, y), 1, s, {});
	const other = game.others?.[0];
	expect(other?.action?.flags).toBe(ACTION_FLAG.guarding);
});

test('snapshotToGame renders snapshot monsters/projectiles with the predicted own Avatar', () => {
	const field = loadField();
	const predicted = { ...spawnAvatar(33, y), facing: -1 as const };
	const game = snapshotToGame(field, predicted, 1, snapshot(), {});
	const zone = game.world.zones['field-01'];
	expect(game.player.avatar.x).toBe(33);
	expect(game.player.avatar.facing).toBe(-1);
	expect(game.player.progress).toEqual({ level: 4, xp: 30, gold: 11 });
	expect(zone.monsters.length).toBe(1);
	expect(zone.monsters[0].type).toBe('chaser');
	expect(zone.projectiles.length).toBe(1);
	expect(game.world.tick).toBe(12);
	expect(game.others).toEqual([]);
});

test('snapshotToGame carries snapshot CombatEvents through for the particle system (#130)', () => {
	const field = loadField();
	const s = snapshot();
	s.events = [{ kind: 'hit', targetId: 5, x: 60, y, intensity: 8, dir: -1 }];
	const game = snapshotToGame(field, spawnAvatar(33, y), 1, s, {});
	expect(game.events).toEqual([
		{ kind: 'hit', targetId: 5, x: 60, y, intensity: 8, dir: -1 },
	]);
});

test('snapshotToGame has no CombatEvents before the first snapshot', () => {
	const field = loadField();
	const game = snapshotToGame(field, spawnAvatar(10, y), 1, null, {});
	expect(game.events ?? []).toEqual([]);
});

test('snapshotToGame degrades gracefully before the first snapshot', () => {
	const field = loadField();
	const game = snapshotToGame(field, spawnAvatar(10, y), 1, null, {});
	expect(game.world.zones['field-01'].monsters.length).toBe(0);
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
	// sampling looks back INTERP_DELAY_MS to t=1025, midway between the 40 and 60 frames
	const view = net.sample(1025 + INTERP_DELAY_MS);
	expect(view?.avatars[0].x).toBe(50);
	net.close();
});

test('NetClient.sample is null until the first snapshot arrives', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	expect(net.sample(1000)).toBe(null);
	net.close();
});

test('NetClient drops the interpolation buffer (and tracks the Zone) on a Zone change', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest(snapAt(40), 1000);
	const town = snapAt(12);
	town.zoneId = 'town-01';
	net.ingest(town, 1050);
	expect(net.zoneId).toBe('town-01');
	// no cross-zone interpolation: sampling midway yields only the new zone's frame
	const view = net.sample(1025 + INTERP_DELAY_MS);
	expect(view?.zoneId).toBe('town-01');
	expect(view?.avatars[0].x).toBe(12);
	net.close();
});

test('NetClient surfaces a createRejected to the caller without closing (the creator can retry, #304)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	const reasons: Array<'taken' | 'invalid'> = [];
	net.onCreateRejected = (reason) => reasons.push(reason);
	net.ingest({ t: 'createRejected', reason: 'taken' }, 1000);
	net.ingest({ t: 'createRejected', reason: 'invalid' }, 1010);
	expect(reasons).toEqual(['taken', 'invalid']);
	expect(net.rejected).toBe(null);
	net.close();
});

test('NetClient fires onSpawned once, on the first snapshot (the createAvatar landed, #304)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	let spawns = 0;
	net.onSpawned = () => spawns++;
	net.ingest(snapAt(40), 1000);
	net.ingest(snapAt(60), 1050);
	expect(spawns).toBe(1);
	net.close();
});

test('NetClient.ingest collects chat lines attributed to the sender handle', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest(
		{ t: 'chat', sessionId: 1, handle: 'neo', text: 'hi field' },
		1000,
	);
	net.ingest({ t: 'chat', sessionId: 2, handle: 'trinity', text: 'hey' }, 1010);
	expect(net.chatLog).toEqual(['neo: hi field', 'trinity: hey']);
	net.close();
});

test('NetClient.chatLog is bounded so it cannot grow without limit', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	for (let i = 0; i < 200; i++)
		net.ingest(
			{ t: 'chat', sessionId: 3, handle: 'spammer', text: `msg ${i}` },
			1000 + i,
		);
	expect(net.chatLog.length).toBeLessThanOrEqual(100);
	expect(net.chatLog.at(-1)).toBe('spammer: msg 199');
	net.close();
});

test('NetClient.ingest renders a whisper distinctly by direction (#40)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.sessionId = 7;
	net.ingest(
		{ t: 'whisper', fromSessionId: 9, from: 'neo', to: 'tester', text: 'hi' },
		1000,
	);
	net.ingest(
		{ t: 'whisper', fromSessionId: 7, from: 'tester', to: 'neo', text: 'yo' },
		1010,
	);
	expect(net.chatLog).toEqual(['[neo → you] hi', '[you → neo] yo']);
	net.close();
});

test('NetClient.ingest does NOT open a Speech bubble for a private whisper', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.sessionId = 7;
	net.ingest(
		{ t: 'whisper', fromSessionId: 9, from: 'neo', to: 'tester', text: 'psst' },
		1000,
	);
	expect(net.bubbles.size).toBe(0);
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

test('NetClient.ingest opens a Speech bubble keyed to the sender, replacing the prior one', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest({ t: 'chat', sessionId: 2, handle: 'rival', text: 'hi' }, 1000);
	expect(net.bubbles.get(2)?.text).toBe('hi');
	net.ingest({ t: 'chat', sessionId: 2, handle: 'rival', text: 'bye' }, 1100);
	expect(net.bubbles.get(2)?.text).toBe('bye');
	expect(net.bubbles.size).toBe(1);
	net.close();
});

test('NetClient.decayBubbles expires a bubble after its length-scaled ttl', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest({ t: 'chat', sessionId: 5, handle: 'neo', text: 'gg' }, 1000);
	// ttl floor is 3s: alive at 2s, expired at 4s
	net.decayBubbles(2);
	expect(net.bubbles.has(5)).toBe(true);
	net.decayBubbles(2);
	expect(net.bubbles.has(5)).toBe(false);
	net.close();
});

test('snapshotToGame threads a co-present Avatar body emote through its action (ADR 0020 §9)', () => {
	const field = loadField();
	const s = withOther();
	s.avatars[1].action = {
		move: 'idle',
		phase: 'recovery',
		progress: 0,
		flags: 0,
		emote: 'wave',
		emoteT: 1.0,
	};
	const game = snapshotToGame(field, spawnAvatar(33, y), 1, s, {});
	expect(game.others?.[0]?.action?.emote).toBe('wave');
	expect(game.others?.[0]?.action?.emoteT).toBeCloseTo(1.0);
});

test('snapshotToGame preserves the own predicted Avatar emote state (ADR 0020 §9)', () => {
	const field = loadField();
	const predicted = { ...spawnAvatar(33, y), emoteId: 'wave', emoteT: 1.2 };
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	expect(game.player.avatar.emoteId).toBe('wave');
	expect(game.player.avatar.emoteT).toBeCloseTo(1.2);
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
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest(
		{
			t: 'welcome',
			sessionId: 7,
			zoneId: 'field-01',
			tickRate: 20,
			handle: 'Tester',
			isNew: false,
		},
		0,
	);
	expect(net.sessionId).toBe(7);
	expect(net.ready).toBe(true);
	// server may resolve the key to a different durable Handle; the client adopts it
	expect(net.handle).toBe('Tester');
	net.ingest(snapAt(42), 1000);
	expect(net.latest?.avatars[0].x).toBe(42);
	net.close();
});

test('NetClient defers the "signed in as" notice to spawn for a new account, showing the claimed name (#317)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'ash', FAKE_IDENTITY);
	net.ingest(
		{
			t: 'welcome',
			sessionId: 1,
			zoneId: 'field-01',
			tickRate: 20,
			handle: 'ash',
			isNew: true,
		},
		0,
	);
	expect(net.chatLog).toEqual([]);
	const spawn = snapshot();
	spawn.avatars[0].handle = 'Legolas';
	net.ingest(spawn, 1000);
	expect(net.chatLog).toEqual(['* signed in as Legolas']);
	net.ingest(snapAt(60), 1050);
	expect(net.chatLog).toEqual(['* signed in as Legolas']);
	net.close();
});

test('NetClient fires the "signed in as" notice on welcome for a returning account, with the durable name (#317)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'ash', FAKE_IDENTITY);
	net.ingest(
		{
			t: 'welcome',
			sessionId: 1,
			zoneId: 'field-01',
			tickRate: 20,
			handle: 'Aragorn',
			isNew: false,
		},
		0,
	);
	expect(net.chatLog).toEqual(['* signed in as Aragorn']);
	net.ingest(snapAt(40), 1000);
	expect(net.chatLog).toEqual(['* signed in as Aragorn']);
	net.close();
});

test('NetClient hands a challenge nonce to the identity signer (#235)', async () => {
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

test('NetClient surfaces a signer failure as a rejection (#235)', async () => {
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
	// two microtask hops: the rejected sign promise, then the failure handler
	await Promise.resolve();
	await Promise.resolve();
	expect(saw.reason).toBe('ssh-agent refused to sign');
	expect(net.rejected).toBe('ssh-agent refused to sign');
	net.close();
});
