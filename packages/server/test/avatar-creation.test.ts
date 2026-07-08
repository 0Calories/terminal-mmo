// Server-gated Avatar creation + deferred spawn (#302, ADR 0028). Drives the real
// `onMessage` handshake with fake sockets — no live listener — to prove the server, not a
// client flag, decides new-vs-returning from its Save lookup: a brand-new account is held
// authenticated but UNSPAWNED (absent from every Zone, never broadcast) until it sends
// `createAvatar`, which mints the Save and spawns it into the starting Town; a returning
// account is restored straight away with `isNew=false` (no creator) and its saved Cosmetics.
//
// The store is an in-memory sqlite and the version gate is off (dev server), so the import
// below must set the env BEFORE the module evaluates (it opens the store at load) — hence
// the dynamic import.
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

// A throwaway ed25519 identity (mirrors auth.test): the OpenSSH one-line public key plus a
// signer producing the agent-style signature blob the server verifies over a nonce.
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

// A minimal stand-in for the Bun ServerWebSocket: it records the frames the server sends so
// the test can read back the challenge / welcome, and stubs `close` (used by `reject`).
// `data.sessionId` is what the handlers key off, exactly as the real socket's upgrade data.
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

// Drive hello -> challenge -> proof for a socket and identity, returning the decoded welcome.
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
	// AC: not present in ANY Zone — no entity is broadcast to others — before createAvatar.
	expect(zoneOf(currentWorld(), 1)).toBeUndefined();
	expect(avatarOf(currentWorld(), 1)).toBeUndefined();

	// Finalise creation: the Player-typed Handle + chosen Cosmetics arrive now (not on the
	// handshake). The typed Handle is claimed HERE (#304).
	const chosen: Cosmetics = { hue: 5, hat: 1, nameplate: 2, form: 0 };
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'Neo',
			cosmetics: chosen,
		}),
	);

	// AC: createAvatar spawns the Avatar into the starting Town with the typed Handle, chosen
	// look + Weapon.
	expect(zoneOf(currentWorld(), 1)).toBe('town-01');
	const sa = avatarOf(currentWorld(), 1);
	expect(sa?.handle).toBe('Neo');
	expect(sa?.cosmetics).toEqual(chosen);
	expect(sa?.avatar.weapon).toBe(3);
});

test('a returning account restores straight away with isNew=false and its saved Cosmetics (no creator)', () => {
	const id = makeIdentity();
	const chosen: Cosmetics = { hue: 4, hat: 2, nameplate: 1, form: 0 };

	// First login: create + spawn, which claims the Handle, mints + persists the Save, then
	// disconnect.
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
	// AC: a returning Identity Key never sees the creator...
	expect(welcome.isNew).toBe(false);
	// ...and resolves its durable Handle (the claimed casing), whatever it asked for at the
	// handshake — the claim relocation to createAvatar (#304) doesn't regress the returning path.
	expect(welcome.handle).toBe('Trinity');
	// ...and is spawned into its last Town with its saved Handle + Cosmetics (the minted Save's).
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
	// Fresh Handles: the server module's registry is shared across tests, so these must not
	// collide with any other test's claim. First account claims "Zion" and spawns.
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
	// AC: a taken Handle yields createRejected{taken} and NO spawn.
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
// Drives the real `onMessage` setCosmetics handler with fake sockets: a Town re-customize
// applies to the live entity, persists to the Save (proven by drop+reconnect restoring it),
// and rebroadcasts to a co-located session; a request from a session with no live Avatar is a
// silent no-op. (The Field/Dungeon Town-gate itself is proven purely in serverWorld.test.ts,
// where a session can be placed off-Town without driving the tick loop.)

test('setCosmetics in a Town persists to the Save and rebroadcasts to others in the Zone (#305)', () => {
	// Two accounts, both created into the starting Town — funnelled into one shared sim, so they
	// co-locate and each rides the other's snapshot.
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

	// Session 50 re-customizes while standing in the Town.
	const next: Cosmetics = { hue: 3, hat: 1, nameplate: 2, form: 0 };
	onMessage(
		ws(wa),
		encodeClientMessage({ t: 'setCosmetics', cosmetics: next }),
	);

	// AC (rebroadcast): the new look rides the shared Zone, so session 51's snapshot shows it.
	const seen = worldSnapshotFor(currentWorld(), 51).avatars.find(
		(x) => x.sessionId === 50,
	);
	expect(seen?.cosmetics).toEqual(next);
	// And the live entity itself carries it.
	expect(avatarOf(currentWorld(), 50)?.cosmetics).toEqual(next);

	// AC (persist): drop + reconnect the SAME identity; the Save restores the new look, proving
	// setCosmetics flushed it durably (not just to the live entity).
	dropSession(50);
	const again = fakeWs(52);
	handshake(again, a, 'morpheus', 0);
	expect(zoneOf(currentWorld(), 52)).toBe('town-01');
	expect(avatarOf(currentWorld(), 52)?.cosmetics).toEqual(next);
});

test('setCosmetics from a session with no live Avatar is a silent no-op (#305)', () => {
	// A session held at the creator (authenticated but unspawned) has no live Avatar: a stray
	// setCosmetics must neither crash nor send anything back.
	const id = makeIdentity();
	const w = fakeWs(60);
	handshake(w, id, 'oracle', 0); // new account: held, not yet spawned
	const before = w.sent.length;
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'setCosmetics',
			cosmetics: { hue: 2, hat: 1, nameplate: 1, form: 0 },
		}),
	);
	expect(zoneOf(currentWorld(), 60)).toBeUndefined();
	expect(w.sent.length).toBe(before); // nothing sent back
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
	// AC: an empty field spawns with the placeholder Handle (run through the same claim).
	expect(zoneOf(currentWorld(), 40)).toBe('town-01');
	expect(avatarOf(currentWorld(), 40)?.handle).toBe('wanderer');
});
