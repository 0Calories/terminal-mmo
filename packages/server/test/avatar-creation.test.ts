import { expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { type Cosmetics, DEFAULT_COSMETICS } from '@mmo/core/entities';
import {
	challengePayload,
	encodePublicKeyLine,
	encodeSignatureBlob,
} from '@mmo/core/persistence';
import { decodeServerMessage, encodeClientMessage } from '@mmo/core/protocol';
import {
	type ServerWorld,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/core/world';

process.env.MMO_DB_PATH = ':memory:';
delete process.env.MMO_VERSION;

const { onMessage, dropSession, currentWorld } = await import('../src/index');

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
			version: '',
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
	expect(welcome.isNew).toBe(true);
	expect(zoneOf(currentWorld(), 1)).toBeUndefined();
	expect(avatarOf(currentWorld(), 1)).toBeUndefined();

	const chosen: Cosmetics = { hue: 5, hat: '', nameplate: 2, form: 'buddy' };
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
	const chosen: Cosmetics = { hue: 4, hat: '', nameplate: 1, form: 'buddy' };

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
	dropSession(10);

	const second = fakeWs(11);
	const welcome = handshake(second, id, 'whatever-it-asks', 0);
	expect(welcome.isNew).toBe(false);
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
	expect(zoneOf(currentWorld(), 99)).toBeUndefined();
	expect(w.sent.length).toBe(0);
});

test('a taken Handle is rejected with createRejected and does not spawn; the session stays held for a retry', () => {
	// Handles must be unique — the server's Handle registry is shared across tests.
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

test('setCosmetics in a Town persists to the Save and rebroadcasts to others in the Zone (#305)', () => {
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

	const next: Cosmetics = { hue: 3, hat: '', nameplate: 2, form: 'buddy' };
	onMessage(
		ws(wa),
		encodeClientMessage({ t: 'setCosmetics', cosmetics: next }),
	);

	const seen = worldSnapshotFor(currentWorld(), 51).avatars.find(
		(x) => x.sessionId === 50,
	);
	expect(seen?.cosmetics).toEqual(next);
	expect(avatarOf(currentWorld(), 50)?.cosmetics).toEqual(next);

	dropSession(50);
	const again = fakeWs(52);
	handshake(again, a, 'morpheus', 0);
	expect(zoneOf(currentWorld(), 52)).toBe('town-01');
	expect(avatarOf(currentWorld(), 52)?.cosmetics).toEqual(next);
});

test('setCosmetics from a session with no live Avatar is a silent no-op (#305)', () => {
	const id = makeIdentity();
	const w = fakeWs(60);
	handshake(w, id, 'oracle', 0);
	const before = w.sent.length;
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'setCosmetics',
			cosmetics: { hue: 2, hat: '', nameplate: 1, form: 'buddy' },
		}),
	);
	expect(zoneOf(currentWorld(), 60)).toBeUndefined();
	expect(w.sent.length).toBe(before);
});

test('confirming an empty Handle field uses the auto-derived placeholder, still uniqueness-checked', () => {
	const id = makeIdentity();
	const w = fakeWs(40);
	handshake(w, id, 'wanderer', 0);
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

// validHatIds is the real scanned set (ADR 0031: cap, crown, party-hat,
// top-hat, wizard) — 'no-such-hat' is dangling regardless, so it must fall
// back to ''.
test('createAvatar with a dangling hat id stores it as no-hat', () => {
	const id = makeIdentity();
	const w = fakeWs(70);
	handshake(w, id, 'dangling-create', 0);
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'DanglingCreate',
			cosmetics: { hue: 1, hat: 'no-such-hat', nameplate: 0, form: 'buddy' },
		}),
	);
	expect(avatarOf(currentWorld(), 70)?.cosmetics.hat).toBe('');
});

test('setCosmetics with a dangling hat id stores it as no-hat', () => {
	const id = makeIdentity();
	const w = fakeWs(71);
	handshake(w, id, 'dangling-set', 0);
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'createAvatar',
			handle: 'DanglingSet',
			cosmetics: DEFAULT_COSMETICS,
		}),
	);
	onMessage(
		ws(w),
		encodeClientMessage({
			t: 'setCosmetics',
			cosmetics: { hue: 1, hat: 'no-such-hat', nameplate: 0, form: 'buddy' },
		}),
	);
	expect(avatarOf(currentWorld(), 71)?.cosmetics.hat).toBe('');
});

test('malformed bytes are dropped without throwing or crashing the server', () => {
	const w = fakeWs(90);
	const garbage = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
	expect(() => onMessage(ws(w), garbage)).not.toThrow();
	expect(w.sent.length).toBe(0);
});
