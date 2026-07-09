import { expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import {
	challengePayload,
	claimHandle,
	createAccountRegistry,
	encodePublicKeyLine,
	encodeSignatureBlob,
	handleForKey,
	parsePublicKeyLine,
	resolveAuth,
	validHandle,
	verifyChallenge,
} from '../src';

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
	expect(parsePublicKeyLine('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB')).toBeNull();
	expect(parsePublicKeyLine('')).toBeNull();
	expect(parsePublicKeyLine('ssh-ed25519')).toBeNull();
	expect(parsePublicKeyLine('ssh-ed25519 !!!not-base64!!!')).toBeNull();
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
	expect(verifyChallenge('not a key', NONCE, good)).toBe(false);
});

test('a first claim binds the username to the key; the key resolves to it after', () => {
	const id = makeIdentity();
	const res = claimHandle(createAccountRegistry(), id.line, 'Neo');
	if (!res.ok) throw new Error('claim should succeed');
	expect(res.handle).toBe('Neo');
	expect(handleForKey(res.registry, id.line)).toBe('Neo');
});

test('a second key cannot claim the same username, case-insensitively', () => {
	const a = makeIdentity();
	const b = makeIdentity();
	const first = claimHandle(createAccountRegistry(), a.line, 'Neo');
	if (!first.ok) throw new Error('first claim should succeed');
	const second = claimHandle(first.registry, b.line, 'neo');
	expect(second.ok).toBe(false);
	if (second.ok) throw new Error('unreachable');
	expect(second.reason).toBe('taken');
});

test('a key that already owns a username keeps it — re-claiming returns the original', () => {
	const id = makeIdentity();
	const first = claimHandle(createAccountRegistry(), id.line, 'Neo');
	if (!first.ok) throw new Error('first claim should succeed');
	const again = claimHandle(first.registry, id.line, 'Morpheus');
	if (!again.ok) throw new Error('re-claim should resolve, not fail');
	expect(again.handle).toBe('Neo');
	expect(handleForKey(again.registry, id.line)).toBe('Neo');
});

test('validHandle enforces the allowed shape', () => {
	expect(validHandle('neo')).toBe(true);
	expect(validHandle('Neo_42')).toBe(true);
	expect(validHandle('a-b')).toBe(true);
	expect(validHandle('x')).toBe(false);
	expect(validHandle('a'.repeat(17))).toBe(false);
	expect(validHandle('bad name')).toBe(false);
	expect(validHandle('naïve')).toBe(false);
	expect(validHandle('')).toBe(false);
});

test('claimHandle rejects an invalid username', () => {
	const res = claimHandle(
		createAccountRegistry(),
		makeIdentity().line,
		'not ok!!',
	);
	expect(res.ok).toBe(false);
	if (res.ok) throw new Error('unreachable');
	expect(res.reason).toBe('invalid');
});

test('resolveAuth: a brand-new key is admitted UNCLAIMED — the Handle is claimed later at createAvatar', () => {
	const id = makeIdentity();
	const res = resolveAuth(
		createAccountRegistry(),
		id.line,
		NONCE,
		id.signChallenge(NONCE),
		'Trinity',
	);
	if (!res.ok) throw new Error(`expected success, got: ${res.reason}`);
	expect(res.handle).toBe('Trinity');
	expect(handleForKey(res.registry, id.line)).toBeUndefined();
});

test('resolveAuth: a returning key resolves its durable Handle, whatever handle it asks for', () => {
	const id = makeIdentity();
	const seeded = claimHandle(createAccountRegistry(), id.line, 'Trinity');
	if (!seeded.ok) throw new Error('seed claim should succeed');
	const nonce2 = new Uint8Array(32).fill(3);
	const back = resolveAuth(
		seeded.registry,
		id.line,
		nonce2,
		id.signChallenge(nonce2),
		'SomebodyElse',
	);
	if (!back.ok) throw new Error('returning auth should succeed');
	expect(back.handle).toBe('Trinity');
});

test('resolveAuth rejects a bad signature before resolving any Handle', () => {
	const a = makeIdentity();
	const b = makeIdentity();
	const badSig = resolveAuth(
		createAccountRegistry(),
		b.line,
		NONCE,
		a.signChallenge(NONCE),
		'Smith',
	);
	expect(badSig.ok).toBe(false);
	if (badSig.ok) throw new Error('unreachable');
	expect(badSig.reason.length).toBeGreaterThan(0);
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
