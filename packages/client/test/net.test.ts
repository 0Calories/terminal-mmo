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
} from '@mmo/shared';
import { INTERP_DELAY_MS } from '../src/interp';
import { NetClient, snapshotToGame } from '../src/net';

const y = GROUND_TOP - BOX.h;

// A stub SSH identity (#235): NetClient only needs a key to offer and a signer
// for the challenge — no real crypto in these transport tests (the verifier has
// its own seam tests in @mmo/shared).
const FAKE_IDENTITY = {
	publicKey: 'ssh-ed25519 AAAATEST',
	signChallenge: async () => Uint8Array.of(1, 2, 3),
};

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
				cosmetics: { hue: 2, hat: 1, nameplate: 4, form: 0 },
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
		effects: [],
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
		cosmetics: { hue: 5, hat: 3, nameplate: 6, form: 0 },
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
	expect(other?.name).toBe('rival'); // handle threaded through for the nameplate
	expect(other?.x).toBe(70);
	expect(other?.facing).toBe(-1);
	expect(other?.hp).toBe(30);
	expect(other?.hurtT).toBe(0.5);
});

test('snapshotToGame threads cosmetics onto co-present Avatars and the own Avatar (#35)', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	// The co-present rival carries the cosmetics from its snapshot.
	expect(game.others?.[0]?.cosmetics).toEqual({
		hue: 5,
		hat: 3,
		nameplate: 6,
		form: 0,
	});
	// The own (locally-predicted) Avatar is stamped with its own snapshot cosmetics,
	// so the local view matches what every other client renders.
	expect(game.player.avatar.cosmetics).toEqual({
		hue: 2,
		hat: 1,
		nameplate: 4,
		form: 0,
	});
});

test('snapshotToGame threads the replicated weapon onto co-present + own Avatars (ADR 0017 §14)', () => {
	const field = loadField();
	const predicted = spawnAvatar(33, y);
	const game = snapshotToGame(field, predicted, 1, withOther(), {});
	// The co-present rival's weapon comes from its snapshot, so we render ITS weapon.
	expect(game.others?.[0]?.weapon).toBe(2);
	// The own (predicted) Avatar is stamped with its own snapshot weapon, so the local
	// view composites the same weapon every other client sees.
	expect(game.player.avatar.weapon).toBe(0);
});

test('snapshotToGame threads a co-present Avatar Guard stance onto its entity action (ADR 0017 §5/§10)', () => {
	const field = loadField();
	const s = withOther();
	// The rival is mid-block: guarding.
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
	// The replicated `flags` ride onto the rebuilt entity's action — the exact seam the
	// playfield's drawGuard reads to render another Player's brace.
	expect(other?.action?.flags).toBe(ACTION_FLAG.guarding);
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

test('snapshotToGame carries snapshot Effects through for the particle system (#130)', () => {
	const field = loadField();
	const s = snapshot();
	s.effects = [{ kind: 'blood', x: 60, y, intensity: 8, dir: -1 }];
	const game = snapshotToGame(field, spawnAvatar(33, y), 1, s, {});
	expect(game.effects).toEqual([
		{ kind: 'blood', x: 60, y, intensity: 8, dir: -1 },
	]);
});

test('snapshotToGame has no Effects before the first snapshot', () => {
	const field = loadField();
	const game = snapshotToGame(field, spawnAvatar(10, y), 1, null, {});
	expect(game.effects ?? []).toEqual([]);
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
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
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
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	expect(net.sample(1000)).toBe(null);
	net.close();
});

test('NetClient drops the interpolation buffer (and tracks the Zone) on a Zone change', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
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
	// the most recent line is retained
	expect(net.chatLog.at(-1)).toBe('spammer: msg 199');
	net.close();
});

test('NetClient.ingest renders a whisper distinctly by direction (#40)', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
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
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.sessionId = 7;
	net.ingest(
		{ t: 'whisper', fromSessionId: 9, from: 'neo', to: 'tester', text: 'psst' },
		1000,
	);
	expect(net.bubbles.size).toBe(0); // whispers are private — no over-head bubble
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
	// A new message from the same sender replaces the text (one bubble per sender).
	net.ingest({ t: 'chat', sessionId: 2, handle: 'rival', text: 'bye' }, 1100);
	expect(net.bubbles.get(2)?.text).toBe('bye');
	expect(net.bubbles.size).toBe(1);
	net.close();
});

test('NetClient.decayBubbles expires a bubble after its length-scaled ttl', () => {
	const net = new NetClient('ws://127.0.0.1:1', 'tester', FAKE_IDENTITY);
	net.ingest({ t: 'chat', sessionId: 5, handle: 'neo', text: 'gg' }, 1000);
	net.decayBubbles(2); // 2s elapsed, ttl floor is 3s -> still alive
	expect(net.bubbles.has(5)).toBe(true);
	net.decayBubbles(2); // 4s total -> expired
	expect(net.bubbles.has(5)).toBe(false);
	net.close();
});

test('snapshotToGame threads a co-present Avatar body emote through its action (ADR 0020 §9)', () => {
	// The emote is no longer a separate over-head relay — it rides the replicated action-
	// state, so an observer who arrives mid-emote still sees the pose. snapshotToGame just
	// carries the action onto the rebuilt entity; the renderer reads `action.emote` from it.
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
	// The local Avatar predicts its own emote (no `action`), so its `emoteId`/`emoteT`
	// must survive the rebuild for the renderer to pose the wave with zero lag.
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
		},
		0,
	);
	expect(net.sessionId).toBe(7);
	expect(net.ready).toBe(true);
	// The durable Handle the server resolved this key to (#235) — may differ from
	// the requested one; the client adopts it.
	expect(net.handle).toBe('Tester');
	net.ingest(snapAt(42), 1000);
	expect(net.latest?.avatars[0].x).toBe(42);
	net.close();
});

test('NetClient hands a challenge nonce to the identity signer (#235)', async () => {
	// The transport's half of challenge-response: a `challenge` frame routes its
	// nonce to the SSH identity. (Domain separation lives inside the identity's
	// signChallenge; the resulting proof send needs an open socket, exercised in
	// the end-to-end run.)
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
	await Promise.resolve(); // let the async signer settle
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
	// Two microtask hops: the rejected sign promise, then the failure handler.
	await Promise.resolve();
	await Promise.resolve();
	expect(saw.reason).toBe('ssh-agent refused to sign');
	expect(net.rejected).toBe('ssh-agent refused to sign');
	net.close();
});
