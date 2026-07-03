// SSH-key challenge-response auth (ADR 0004, #235): the pure verifier and the
// username-claim registry. Everything here is socket-free — keys are generated
// in-process and signatures produced with node:crypto, exactly the bytes an
// ssh-agent would hand the client (the agent signs the raw payload and wraps
// the result in the same {algo, sig} blob `encodeSignatureBlob` builds).
import { expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import {
	challengePayload,
	claimUsername,
	createAccountRegistry,
	encodePublicKeyLine,
	encodeSignatureBlob,
	parsePublicKeyLine,
	resolveAuth,
	usernameForKey,
	validUsername,
	verifyChallenge,
} from '../src';

// A throwaway ed25519 identity: the OpenSSH one-line public key plus a signer
// producing the agent-style signature blob over a challenge nonce.
function makeIdentity(comment?: string) {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const jwk = publicKey.export({ format: 'jwk' });
	const raw = new Uint8Array(Buffer.from(jwk.x as string, 'base64url'));
	return {
		line: encodePublicKeyLine(raw, comment),
		signChallenge: (nonce: Uint8Array) =>
			signBlob(privateKey, challengePayload(nonce)),
	};
}

function signBlob(privateKey: KeyObject, payload: Uint8Array): Uint8Array {
	return encodeSignatureBlob(new Uint8Array(sign(null, payload, privateKey)));
}

const NONCE = new Uint8Array(32).fill(7);

// --- public-key line parsing -------------------------------------------------

test('parsePublicKeyLine reads an ssh-ed25519 line, with or without a comment', () => {
	const bare = makeIdentity().line;
	const parsed = parsePublicKeyLine(bare);
	expect(parsed?.algo).toBe('ssh-ed25519');
	expect(parsed?.key.length).toBe(32);

	const commented = makeIdentity('dev@laptop').line;
	expect(commented.endsWith(' dev@laptop')).toBe(true);
	const p2 = parsePublicKeyLine(commented);
	expect(p2?.comment).toBe('dev@laptop');
});

test('parsePublicKeyLine rejects other key types and garbage', () => {
	// An RSA line (algo mismatch inside the blob too) and assorted junk must all
	// come back null rather than throw — the server feeds it untrusted input.
	expect(parsePublicKeyLine('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB')).toBeNull();
	expect(parsePublicKeyLine('')).toBeNull();
	expect(parsePublicKeyLine('ssh-ed25519')).toBeNull();
	expect(parsePublicKeyLine('ssh-ed25519 !!!not-base64!!!')).toBeNull();
	// Valid base64 but the inner blob names a different algorithm than the label.
	expect(
		parsePublicKeyLine(
			`ssh-ed25519 ${Buffer.from('garbage blob').toString('base64')}`,
		),
	).toBeNull();
});

test('encodePublicKeyLine → parsePublicKeyLine round-trips the raw key', () => {
	const raw = new Uint8Array(32).map((_, i) => i);
	const parsed = parsePublicKeyLine(encodePublicKeyLine(raw));
	expect(parsed?.key).toEqual(raw);
});

// --- the pure verifier ---------------------------------------------------------

test('verifyChallenge accepts a valid signature', () => {
	const id = makeIdentity();
	expect(verifyChallenge(id.line, NONCE, id.signChallenge(NONCE))).toBe(true);
});

test('verifyChallenge rejects a signature over a different nonce', () => {
	const id = makeIdentity();
	const otherNonce = new Uint8Array(32).fill(9);
	expect(verifyChallenge(id.line, NONCE, id.signChallenge(otherNonce))).toBe(
		false,
	);
});

test('verifyChallenge rejects the wrong key', () => {
	const signer = makeIdentity();
	const other = makeIdentity();
	expect(verifyChallenge(other.line, NONCE, signer.signChallenge(NONCE))).toBe(
		false,
	);
});

test('verifyChallenge rejects a tampered / garbage signature blob without throwing', () => {
	const id = makeIdentity();
	const good = id.signChallenge(NONCE);
	const tampered = new Uint8Array(good);
	tampered[tampered.length - 1] ^= 0xff;
	expect(verifyChallenge(id.line, NONCE, tampered)).toBe(false);
	expect(verifyChallenge(id.line, NONCE, new Uint8Array(0))).toBe(false);
	expect(verifyChallenge(id.line, NONCE, new Uint8Array(64))).toBe(false);
	// An unparseable public key also verifies false rather than throwing.
	expect(verifyChallenge('not a key', NONCE, good)).toBe(false);
});

// --- username claim registry ---------------------------------------------------

test('a first claim binds the username to the key; the key resolves to it after', () => {
	const id = makeIdentity();
	const res = claimUsername(createAccountRegistry(), id.line, 'Neo');
	if (!res.ok) throw new Error('claim should succeed');
	expect(res.username).toBe('Neo');
	expect(usernameForKey(res.registry, id.line)).toBe('Neo');
});

test('a second key cannot claim the same username, case-insensitively', () => {
	const a = makeIdentity();
	const b = makeIdentity();
	const first = claimUsername(createAccountRegistry(), a.line, 'Neo');
	if (!first.ok) throw new Error('first claim should succeed');
	const second = claimUsername(first.registry, b.line, 'neo');
	expect(second.ok).toBe(false);
	if (second.ok) throw new Error('unreachable');
	expect(second.reason).toBe('taken');
});

test('a key that already owns a username keeps it — re-claiming returns the original', () => {
	const id = makeIdentity();
	const first = claimUsername(createAccountRegistry(), id.line, 'Neo');
	if (!first.ok) throw new Error('first claim should succeed');
	// Same key, different desired name: identity is durable, so the registered
	// username wins and the registry is unchanged.
	const again = claimUsername(first.registry, id.line, 'Morpheus');
	if (!again.ok) throw new Error('re-claim should resolve, not fail');
	expect(again.username).toBe('Neo');
	expect(usernameForKey(again.registry, id.line)).toBe('Neo');
});

test('validUsername enforces the allowed shape', () => {
	expect(validUsername('neo')).toBe(true);
	expect(validUsername('Neo_42')).toBe(true);
	expect(validUsername('a-b')).toBe(true);
	expect(validUsername('x')).toBe(false); // too short
	expect(validUsername('a'.repeat(17))).toBe(false); // too long
	expect(validUsername('bad name')).toBe(false); // whitespace
	expect(validUsername('naïve')).toBe(false); // non-ascii
	expect(validUsername('')).toBe(false);
});

test('claimUsername rejects an invalid username', () => {
	const res = claimUsername(
		createAccountRegistry(),
		makeIdentity().line,
		'not ok!!',
	);
	expect(res.ok).toBe(false);
	if (res.ok) throw new Error('unreachable');
	expect(res.reason).toBe('invalid');
});

// --- resolveAuth: the whole server-side decision, sockets excluded ---------------

test('resolveAuth: sign → verify → first launch claims the desired username', () => {
	const id = makeIdentity();
	const res = resolveAuth(
		createAccountRegistry(),
		id.line,
		NONCE,
		id.signChallenge(NONCE),
		'Trinity',
	);
	if (!res.ok) throw new Error(`expected success, got: ${res.reason}`);
	expect(res.username).toBe('Trinity');
	expect(usernameForKey(res.registry, id.line)).toBe('Trinity');
});

test('resolveAuth: a returning key resolves to the same identity, whatever handle it asks for', () => {
	const id = makeIdentity();
	const first = resolveAuth(
		createAccountRegistry(),
		id.line,
		NONCE,
		id.signChallenge(NONCE),
		'Trinity',
	);
	if (!first.ok) throw new Error('first auth should succeed');
	const nonce2 = new Uint8Array(32).fill(3);
	const back = resolveAuth(
		first.registry,
		id.line,
		nonce2,
		id.signChallenge(nonce2),
		'SomebodyElse',
	);
	if (!back.ok) throw new Error('returning auth should succeed');
	expect(back.username).toBe('Trinity');
});

test('resolveAuth rejects a bad signature and a taken username with human-readable reasons', () => {
	const a = makeIdentity();
	const b = makeIdentity();
	const seeded = resolveAuth(
		createAccountRegistry(),
		a.line,
		NONCE,
		a.signChallenge(NONCE),
		'Trinity',
	);
	if (!seeded.ok) throw new Error('seed auth should succeed');

	// Wrong key's signature: refused before any claim happens.
	const badSig = resolveAuth(
		seeded.registry,
		b.line,
		NONCE,
		a.signChallenge(NONCE),
		'Smith',
	);
	expect(badSig.ok).toBe(false);
	if (badSig.ok) throw new Error('unreachable');
	expect(badSig.reason.length).toBeGreaterThan(0);

	// Valid signature, but the desired name belongs to another key.
	const taken = resolveAuth(
		seeded.registry,
		b.line,
		NONCE,
		b.signChallenge(NONCE),
		'trinity',
	);
	expect(taken.ok).toBe(false);
	if (taken.ok) throw new Error('unreachable');
	expect(taken.reason).toContain('trinity');
});

test('resolveAuth rejects an unparseable public key', () => {
	const res = resolveAuth(
		createAccountRegistry(),
		'ssh-rsa AAAA...',
		NONCE,
		new Uint8Array(0),
		'Smith',
	);
	expect(res.ok).toBe(false);
});
