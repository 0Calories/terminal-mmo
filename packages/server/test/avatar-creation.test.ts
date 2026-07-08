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

	// Finalise creation: the chosen Cosmetics arrive now (not on the handshake).
	const chosen: Cosmetics = { hue: 5, hat: 1, nameplate: 2, form: 0 };
	onMessage(
		ws(w),
		encodeClientMessage({ t: 'createAvatar', cosmetics: chosen }),
	);

	// AC: createAvatar spawns the Avatar into the starting Town with the chosen look + Weapon.
	expect(zoneOf(currentWorld(), 1)).toBe('town-01');
	const sa = avatarOf(currentWorld(), 1);
	expect(sa?.cosmetics).toEqual(chosen);
	expect(sa?.avatar.weapon).toBe(3);
});

test('a returning account restores straight away with isNew=false and its saved Cosmetics (no creator)', () => {
	const id = makeIdentity();
	const chosen: Cosmetics = { hue: 4, hat: 2, nameplate: 1, form: 0 };

	// First login: create + spawn, which mints and persists the Save, then disconnect.
	const first = fakeWs(10);
	expect(handshake(first, id, 'trinity', 1).isNew).toBe(true);
	onMessage(
		ws(first),
		encodeClientMessage({ t: 'createAvatar', cosmetics: chosen }),
	);
	dropSession(10); // releases the identity presence so the same key can reconnect

	// Second login of the SAME identity: the Save now exists, so the server restores it.
	const second = fakeWs(11);
	const welcome = handshake(second, id, 'trinity', 0);
	// AC: a returning Identity Key never sees the creator...
	expect(welcome.isNew).toBe(false);
	// ...and is spawned into its last Town with its saved Cosmetics (the minted Save's).
	expect(zoneOf(currentWorld(), 11)).toBe('town-01');
	expect(avatarOf(currentWorld(), 11)?.cosmetics).toEqual(chosen);
});

test('createAvatar from a session the server is not holding is a silent no-op', () => {
	const w = fakeWs(99);
	onMessage(
		ws(w),
		encodeClientMessage({ t: 'createAvatar', cosmetics: DEFAULT_COSMETICS }),
	);
	// No pending-spawn hold ⇒ nothing spawned and nothing sent back.
	expect(zoneOf(currentWorld(), 99)).toBeUndefined();
	expect(w.sent.length).toBe(0);
});
