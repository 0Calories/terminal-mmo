import { describe, expect, test } from 'bun:test';
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
} from '../../src/persistence';

function identity(comment?: string) {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const jwk = publicKey.export({ format: 'jwk' });
	const raw = new Uint8Array(Buffer.from(jwk.x as string, 'base64url'));
	return {
		line: encodePublicKeyLine(raw, comment),
		sign: (nonce: Uint8Array) => signature(privateKey, challengePayload(nonce)),
	};
}

function signature(key: KeyObject, payload: Uint8Array): Uint8Array {
	return encodeSignatureBlob(new Uint8Array(sign(null, payload, key)));
}

const NONCE = new Uint8Array(32).fill(7);

describe('SSH Ed25519 identity encoding', () => {
	test('public key lines round-trip their raw key and optional comment', () => {
		const raw = Uint8Array.from({ length: 32 }, (_, i) => i);
		expect(parsePublicKeyLine(encodePublicKeyLine(raw))?.key).toEqual(raw);
		expect(parsePublicKeyLine(encodePublicKeyLine(raw, 'dev@laptop'))).toEqual({
			algo: 'ssh-ed25519',
			key: raw,
			comment: 'dev@laptop',
		});
	});

	for (const [name, line] of [
		['empty input', ''],
		['missing blob', 'ssh-ed25519'],
		['unsupported algorithm', 'ssh-rsa AAAA'],
		['invalid base64', 'ssh-ed25519 !!!not-base64!!!'],
		[
			'invalid SSH blob',
			`ssh-ed25519 ${Buffer.from('garbage').toString('base64')}`,
		],
	] as const) {
		test(`rejects ${name}`, () => expect(parsePublicKeyLine(line)).toBeNull());
	}
});

describe('challenge verification', () => {
	test('accepts only a signature from the offered key over the offered nonce', () => {
		const signer = identity();
		const other = identity();
		const otherNonce = new Uint8Array(NONCE).fill(9);

		expect(verifyChallenge(signer.line, NONCE, signer.sign(NONCE))).toBe(true);
		expect(verifyChallenge(other.line, NONCE, signer.sign(NONCE))).toBe(false);
		expect(verifyChallenge(signer.line, NONCE, signer.sign(otherNonce))).toBe(
			false,
		);
	});

	test('malformed keys and signature blobs fail closed without throwing', () => {
		const signer = identity();
		const good = signer.sign(NONCE);
		const tampered = new Uint8Array(good);
		tampered[tampered.length - 1] ^= 0xff;

		for (const [line, blob] of [
			[signer.line, tampered],
			[signer.line, new Uint8Array(0)],
			[signer.line, new Uint8Array(64)],
			['not a key', good],
		] as const)
			expect(verifyChallenge(line, NONCE, blob)).toBe(false);
	});
});

describe('Handle ownership', () => {
	test('a first claim binds both indexes and later claims by that key keep it', () => {
		const id = identity();
		const first = claimHandle(createAccountRegistry(), id.line, 'Neo');
		if (!first.ok) throw new Error('claim should succeed');
		expect(handleForKey(first.registry, id.line)).toBe('Neo');

		const again = claimHandle(first.registry, id.line, 'Morpheus');
		expect(again).toMatchObject({ ok: true, handle: 'Neo' });
	});

	test('ownership is unique case-insensitively', () => {
		const owner = identity();
		const first = claimHandle(createAccountRegistry(), owner.line, 'Neo');
		if (!first.ok) throw new Error('claim should succeed');
		expect(claimHandle(first.registry, identity().line, 'neo')).toMatchObject({
			ok: false,
			reason: 'taken',
		});
	});

	for (const [handle, valid] of [
		['Neo_42', true],
		['a-b', true],
		['x', false],
		['a'.repeat(17), false],
		['bad name', false],
		['naïve', false],
		['', false],
	] as const) {
		test(`${JSON.stringify(handle)} is ${valid ? 'valid' : 'invalid'}`, () => {
			expect(validHandle(handle)).toBe(valid);
		});
	}

	test('claims reject invalid Handles', () => {
		expect(
			claimHandle(createAccountRegistry(), identity().line, 'not ok!!'),
		).toMatchObject({ ok: false, reason: 'invalid' });
	});
});

describe('authentication policy', () => {
	test('an unclaimed key is admitted without durably claiming its desired Handle', () => {
		const id = identity();
		const result = resolveAuth(
			createAccountRegistry(),
			id.line,
			NONCE,
			id.sign(NONCE),
			'  Trinity  ',
		);
		if (!result.ok) throw new Error(result.reason);
		expect(result.handle).toBe('Trinity');
		expect(handleForKey(result.registry, id.line)).toBeUndefined();
	});

	test('a returning key resolves its durable Handle, ignoring the requested one', () => {
		const id = identity();
		const claimed = claimHandle(createAccountRegistry(), id.line, 'Trinity');
		if (!claimed.ok) throw new Error('claim should succeed');
		const result = resolveAuth(
			claimed.registry,
			id.line,
			NONCE,
			id.sign(NONCE),
			'SomebodyElse',
		);
		expect(result).toMatchObject({ ok: true, handle: 'Trinity' });
	});

	test('malformed keys and signatures are rejected before Handle resolution', () => {
		const signer = identity();
		for (const [line, blob] of [
			['ssh-rsa AAAA...', new Uint8Array()],
			[identity().line, signer.sign(NONCE)],
		] as const)
			expect(
				resolveAuth(createAccountRegistry(), line, NONCE, blob, 'Smith').ok,
			).toBe(false);
	});
});
