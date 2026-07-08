// Server-gated Avatar creation + deferred spawn (#302, ADR 0028). Drives the real
// `onMessage` handshake with fake sockets to prove the server — not a client flag —
// decides new-vs-returning from its Save lookup: a new account is held unspawned until
// `createAvatar`; a returning one restores straight away with its saved Cosmetics.
//
// The store opens at module load, so the env must be set BEFORE evaluation — hence the
// dynamic import.
import { expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import {
	type Cosmetics,
	challengePayload,
	DEFAULT_COSMETICS,
	decodeServerMessage,
	encodeClientMessage,
	encodePublicKeyLine,
	encodeSignatureBlob,
	type ServerWorld,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/shared';

process.env.MMO_DB_PATH = ':memory:';
delete process.env.MMO_VERSION; // dev server: skip the release version gate

const { onMessage, dropSession, currentWorld } = await import('../src/index');

// A throwaway ed25519 identity (mirrors auth.test): the OpenSSH public-key line + a signer
// producing the signature blob the server verifies over a nonce.
function makeIdentity() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const jwk = publicKey.export({ format: 'jwk' });
	const raw = new Uint8Array(Buffer.from(jwk.x as string, 'base64url'));
	return {
		line: encodePublicKeyLine(raw),
		signChallenge: (nonce: Uint8Array) =>
			signBlob(privateKey, challengePayload(nonce)),
	};
}
function signBlob(privateKey: KeyObject, payload: Uint8Array): Uint8Array {
	return encodeSignatureBlob(new Uint8Array(sign(null, payload, privateKey)));
}

// A stand-in for the Bun ServerWebSocket: records the frames the server sends (so the test
// can read them back) and stubs `close`. `data.sessionId` is what the handlers key off.
type Sent = {
	data: { sessionId: number; ip: string; counted: boolean };
	sent: Uint8Array[];
	send: (b: Uint8Array) => void;
	close: () => void;
};
function fakeWs(sessionId: number): Sent {
	const w: Sent = {
		data: { sessionId, ip: 'test', counted: true },
		sent: [],
		send: (b) => w.sent.push(new Uint8Array(b)),
		close: () => {},
	};
	return w;
}
// Type-safe cast to whatever ServerWebSocket shape `onMessage` expects, without pulling in
// the module's private WsData.
type WsArg = Parameters<typeof onMessage>[0];
const ws = (w: Sent) => w as unknown as WsArg;

function lastSent(w: Sent) {
	const buf = w.sent.at(-1);
	if (!buf) throw new Error('server sent nothing');
	return decodeServerMessage(buf);
}
function avatarOf(world: ServerWorld, sessionId: number) {
	return zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
}

function handshake(
	w: Sent,
	id: ReturnType<typeof makeIdentity>,
	handle: string,
	weapon = 0,
) {
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'hello',
			handle,
			version: '', // dev server: the version gate is off, so any value is admitted
			cosmetics: DEFAULT_COSMETICS,
			weapon,
			publicKey: id.line,
		}),
	);
	const challenge = lastSent(w);
	if (challenge.t !== 'challenge')
		throw new Error(`expected challenge, got ${challenge.t}`);
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'proof',
			signature: id.signChallenge(challenge.nonce),
		}),
	);
	const welcome = lastSent(w);
	if (welcome.t !== 'welcome')
		throw new Error(`expected welcome, got ${welcome.t}`);
	return welcome;
}

test('a new account is held authenticated-but-unspawned until createAvatar, then spawns into the starting Town', () => {
	const id = makeIdentity();
	const w = fakeWs(1);

	const welcome = handshake(w, id, 'neo', 3);
	// The server's verdict comes from its Save lookup (no Save ⇒ new), not any client flag.
	expect(welcome.isNew).toBe(true);
	// Not in any Zone before createAvatar — no entity is broadcast to others.
	expect(zoneOf(currentWorld(), 1)).toBeUndefined();
	expect(avatarOf(currentWorld(), 1)).toBeUndefined();

	// The typed Handle + chosen Cosmetics arrive at createAvatar, not the handshake; the
	// Handle is claimed here (#304).
	const chosen: Cosmetics = { hue: 5, hat: 1, nameplate: 2, form: 0 };
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Neo',
			cosmetics: chosen,
		}),
	);

	expect(zoneOf(currentWorld(), 1)).toBe('town-01');
	const sa = avatarOf(currentWorld(), 1);
	expect(sa?.handle).toBe('Neo');
	expect(sa?.cosmetics).toEqual(chosen);
	expect(sa?.avatar.weapon).toBe(3);
});

test('a returning account restores straight away with isNew=false and its saved Cosmetics (no creator)', () => {
	const id = makeIdentity();
	const chosen: Cosmetics = { hue: 4, hat: 2, nameplate: 1, form: 0 };

	const first = fakeWs(10);
	expect(handshake(first, id, 'trinity', 1).isNew).toBe(true);
	onMessage(
		ws(first),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Trinity',
			cosmetics: chosen,
		}),
	);
	dropSession(10); // releases the identity presence so the same key can reconnect

	// Second login of the SAME identity: the Save now exists, so the server restores it.
	const second = fakeWs(11);
	const welcome = handshake(second, id, 'whatever-it-asks', 0);
	// A returning key never sees the creator...
	expect(welcome.isNew).toBe(false);
	// ...and resolves its durable Handle (claimed casing) whatever it asked for — the #304
	// claim relocation must not regress the returning path.
	expect(welcome.handle).toBe('Trinity');
	expect(zoneOf(currentWorld(), 11)).toBe('town-01');
	expect(avatarOf(currentWorld(), 11)?.handle).toBe('Trinity');
	expect(avatarOf(currentWorld(), 11)?.cosmetics).toEqual(chosen);
});

test('createAvatar from a session the server is not holding is a silent no-op', () => {
	const w = fakeWs(99);
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'nobody',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	// No pending-spawn hold ⇒ nothing spawned and nothing sent back.
	expect(zoneOf(currentWorld(), 99)).toBeUndefined();
	expect(w.sent.length).toBe(0);
});

test('a taken Handle is rejected with createRejected and does not spawn; the session stays held for a retry', () => {
	// The server module's Handle registry is shared across tests, so these Handles must not
	// collide with another test's claim. First account claims "Zion".
	const a = makeIdentity();
	const wa = fakeWs(20);
	handshake(wa, a, 'zion', 0);
	onMessage(
		ws(wa),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Zion',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	expect(avatarOf(currentWorld(), 20)?.handle).toBe('Zion');

	// A DIFFERENT key tries to claim the same Handle, case-insensitively.
	const b = makeIdentity();
	const wb = fakeWs(21);
	handshake(wb, b, 'placeholder-b', 0);
	onMessage(
		ws(wb),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'ZION',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	const rejected = lastSent(wb);
	expect(rejected).toEqual({ t: 'createRejected', reason: 'taken' });
	expect(zoneOf(currentWorld(), 21)).toBeUndefined();

	// The session stays held: a retry with a free Handle now succeeds (no re-handshake).
	onMessage(
		ws(wb),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Cypher',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	expect(avatarOf(currentWorld(), 21)?.handle).toBe('Cypher');
});

test('an invalid Handle is rejected with createRejected{invalid} and does not spawn', () => {
	const id = makeIdentity();
	const w = fakeWs(30);
	handshake(w, id, 'valid-placeholder', 0);
	// "a" is too short for the 2–16 rule.
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'a',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	expect(lastSent(w)).toEqual({ t: 'createRejected', reason: 'invalid' });
	expect(zoneOf(currentWorld(), 30)).toBeUndefined();
});

// --- In-game re-customization: setCosmetics (#305, ADR 0028) ------------------------
// The Field/Dungeon Town-gate itself lives in serverWorld.test.ts (a session can be placed
// off-Town there without driving the tick loop); here we drive the real handler.

test('setCosmetics in a Town persists to the Save and rebroadcasts to others in the Zone (#305)', () => {
	// Two accounts in the starting Town — one shared sim, so they co-locate and each rides the
	// other's snapshot.
	const a = makeIdentity();
	const wa = fakeWs(50);
	handshake(wa, a, 'morpheus', 0);
	onMessage(
		ws(wa),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Morpheus',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	const b = makeIdentity();
	const wb = fakeWs(51);
	handshake(wb, b, 'switch', 0);
	onMessage(
		ws(wb),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Switch',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	expect(zoneOf(currentWorld(), 50)).toBe('town-01');
	expect(zoneOf(currentWorld(), 51)).toBe('town-01');

	const next: Cosmetics = { hue: 3, hat: 1, nameplate: 2, form: 0 };
	onMessage(
		ws(wa),
		encodeClientMessage({ t: 'setCosmetics', cosmetics: next }),
	);

	// Rebroadcast: the new look rides the shared Zone, so session 51's snapshot shows it.
	const seen = worldSnapshotFor(currentWorld(), 51).avatars.find(
		(x) => x.sessionId === 50,
	);
	expect(seen?.cosmetics).toEqual(next);
	expect(avatarOf(currentWorld(), 50)?.cosmetics).toEqual(next);

	// Persist: drop + reconnect the same identity; the Save restores the new look, proving
	// setCosmetics flushed durably (not just to the live entity).
	dropSession(50);
	const again = fakeWs(52);
	handshake(again, a, 'morpheus', 0);
	expect(zoneOf(currentWorld(), 52)).toBe('town-01');
	expect(avatarOf(currentWorld(), 52)?.cosmetics).toEqual(next);
});

test('setCosmetics from a session with no live Avatar is a silent no-op (#305)', () => {
	// A session held at the creator (unspawned) has no live Avatar: a stray setCosmetics must
	// neither crash nor send anything back.
	const id = makeIdentity();
	const w = fakeWs(60);
	handshake(w, id, 'oracle', 0);
	const before = w.sent.length;
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'setCosmetics',
			cosmetics: { hue: 2, hat: 1, nameplate: 1, form: 0 },
		}),
	);
	expect(zoneOf(currentWorld(), 60)).toBeUndefined();
	expect(w.sent.length).toBe(before);
});

test('confirming an empty Handle field uses the auto-derived placeholder, still uniqueness-checked', () => {
	const id = makeIdentity();
	const w = fakeWs(40);
	// The handshake handle is the auto-derived placeholder the client pre-fills the field with.
	handshake(w, id, 'wanderer', 0);
	// Empty typed field ⇒ the server falls back to the placeholder and claims THAT.
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: '',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	expect(zoneOf(currentWorld(), 40)).toBe('town-01');
	expect(avatarOf(currentWorld(), 40)?.handle).toBe('wanderer');
});
