import { afterEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { loadZones, spriteIds } from '@mmo/assets/meta';
import { DEFAULT_COSMETICS } from '@mmo/core/entities';
import {
	challengePayload,
	encodePublicKeyLine,
	encodeSignatureBlob,
} from '@mmo/core/persistence';
import {
	type ClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	type ServerMessage,
} from '@mmo/core/protocol';
import {
	createInMemoryServer,
	createServerRuntime,
	type InMemorySession,
	type ServerRuntime,
} from '../src/runtime';
import { openPlayerStore } from '../src/store';

const NONCE = new Uint8Array(32).fill(7);
const runtimes: ServerRuntime[] = [];

afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime.close();
});

function identity() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const jwk = publicKey.export({ format: 'jwk' });
	const raw = new Uint8Array(Buffer.from(jwk.x as string, 'base64url'));
	return {
		line: encodePublicKeyLine(raw),
		signChallenge: (nonce: Uint8Array) =>
			signature(privateKey, challengePayload(nonce)),
	};
}

function signature(privateKey: KeyObject, payload: Uint8Array): Uint8Array {
	return encodeSignatureBlob(new Uint8Array(sign(null, payload, privateKey)));
}

function setup(
	overrides: Partial<Parameters<typeof createServerRuntime>[0]> = {},
) {
	const runtime = createServerRuntime({
		zones: loadZones(),
		store: openPlayerStore(':memory:'),
		releaseVersion: 'dev',
		nonce: () => new Uint8Array(NONCE),
		validHatIds: spriteIds('hats'),
		validFormIds: spriteIds('forms'),
		log: () => {},
		logError: () => {},
		...overrides,
	});
	runtimes.push(runtime);
	return { runtime, server: createInMemoryServer(runtime) };
}

function send(session: InMemorySession, message: ClientMessage): void {
	session.send(encodeClientMessage(message));
}

function receive(session: InMemorySession): ServerMessage[] {
	return session.receive().map(decodeServerMessage);
}

function onlyMessage(session: InMemorySession): ServerMessage {
	const messages = receive(session);
	expect(messages).toHaveLength(1);
	return messages[0];
}

function sendHello(
	session: InMemorySession,
	publicKey: string,
	handle = 'placeholder',
	version = '',
): void {
	send(session, {
		t: 'hello',
		handle,
		version,
		cosmetics: DEFAULT_COSMETICS,
		weapon: 0,
		publicKey,
	});
}

function authenticate(
	session: InMemorySession,
	credentials: ReturnType<typeof identity>,
	handle = 'placeholder',
): Extract<ServerMessage, { t: 'welcome' }> {
	sendHello(session, credentials.line, handle);
	const challenge = onlyMessage(session);
	if (challenge.t !== 'challenge')
		throw new Error(`expected challenge, got ${challenge.t}`);
	send(session, {
		t: 'proof',
		signature: credentials.signChallenge(challenge.nonce),
	});
	const welcome = onlyMessage(session);
	if (welcome.t !== 'welcome')
		throw new Error(`expected welcome, got ${welcome.t}`);
	return welcome;
}

function createAvatar(
	session: InMemorySession,
	handle: string,
	cosmetics = DEFAULT_COSMETICS,
): void {
	send(session, { t: 'createAvatar', handle, cosmetics });
}

function snapshotAfterTick(
	server: ReturnType<typeof setup>['server'],
	session: InMemorySession,
) {
	server.advanceTick();
	const snapshot = onlyMessage(session);
	if (snapshot.t !== 'snapshot')
		throw new Error(`expected snapshot, got ${snapshot.t}`);
	return snapshot;
}

describe('authentication trust boundaries', () => {
	test('release servers reject mismatched versions before issuing a challenge', () => {
		const { server } = setup({ releaseVersion: '1.2.3' });
		const session = server.connect();
		sendHello(session, identity().line, 'Player', '1.2.2');

		const rejection = onlyMessage(session);
		expect(rejection).toMatchObject({ t: 'reject' });
		expect(rejection.t === 'reject' && rejection.reason).toContain(
			'bunx terminal-mmo@latest',
		);
		expect(session.closed).toBe(true);
	});

	test('malformed public keys and invalid proofs fail closed', () => {
		const invalidKey = setup().server.connect();
		sendHello(invalidKey, 'ssh-rsa not-supported');
		expect(onlyMessage(invalidKey)).toMatchObject({ t: 'reject' });
		expect(invalidKey.closed).toBe(true);

		const { server } = setup();
		const invalidProof = server.connect();
		sendHello(invalidProof, identity().line);
		expect(onlyMessage(invalidProof).t).toBe('challenge');
		send(invalidProof, { t: 'proof', signature: Uint8Array.of(1, 2, 3) });
		expect(onlyMessage(invalidProof)).toMatchObject({ t: 'reject' });
		expect(invalidProof.closed).toBe(true);
	});

	test('one public key cannot hold two live sessions and is released on disconnect', () => {
		const { server } = setup();
		const credentials = identity();
		const first = server.connect();
		authenticate(first, credentials, 'First');

		const duplicate = server.connect();
		sendHello(duplicate, credentials.line, 'Duplicate');
		const challenge = onlyMessage(duplicate);
		if (challenge.t !== 'challenge') throw new Error('expected challenge');
		send(duplicate, {
			t: 'proof',
			signature: credentials.signChallenge(challenge.nonce),
		});
		const rejection = onlyMessage(duplicate);
		expect(rejection.t === 'reject' && rejection.reason).toMatch(
			/already online/i,
		);
		expect(duplicate.closed).toBe(true);

		first.disconnect();
		const replacement = server.connect();
		expect(authenticate(replacement, credentials, 'Replacement').t).toBe(
			'welcome',
		);
	});

	test('frames requiring authentication or a live Avatar are ignored early', () => {
		const { server } = setup();
		const session = server.connect();
		for (const message of [
			{ t: 'proof', signature: new Uint8Array() },
			{
				t: 'createAvatar',
				handle: 'Untrusted',
				cosmetics: DEFAULT_COSMETICS,
			},
			{ t: 'chat', text: 'not authenticated' },
			{ t: 'emote', emote: 'not authenticated' },
		] satisfies ClientMessage[]) {
			send(session, message);
			expect(receive(session)).toEqual([]);
		}
		server.advanceTick();
		expect(receive(session)).toEqual([]);
	});
});

describe('Avatar claim boundaries', () => {
	test('claims enforce validation and case-insensitive uniqueness while allowing retry', () => {
		const { server } = setup();
		const owner = server.connect();
		authenticate(owner, identity(), 'owner');
		createAvatar(owner, 'Claimed');

		const contender = server.connect();
		authenticate(contender, identity(), 'contender');
		for (const [handle, reason] of [
			['CLAIMED', 'taken'],
			['x', 'invalid'],
		] as const) {
			createAvatar(contender, handle);
			expect(onlyMessage(contender)).toEqual({ t: 'createRejected', reason });
		}

		createAvatar(contender, 'Available');
		const snapshot = snapshotAfterTick(server, contender);
		expect(
			snapshot.avatars.find(
				(avatar) => avatar.sessionId === contender.sessionId,
			)?.handle,
		).toBe('Available');
	});

	test('dangling cosmetic ids are sanitized on creation and update', () => {
		const { server } = setup();
		const session = server.connect();
		authenticate(session, identity(), 'cosmetics');
		createAvatar(session, 'Cosmetics', {
			...DEFAULT_COSMETICS,
			hat: 'missing-hat',
			form: 'missing-form',
		});
		let snapshot = snapshotAfterTick(server, session);
		let own = snapshot.avatars.find(
			(avatar) => avatar.sessionId === session.sessionId,
		);
		expect(own?.cosmetics).toEqual(DEFAULT_COSMETICS);

		send(session, {
			t: 'setCosmetics',
			cosmetics: {
				...DEFAULT_COSMETICS,
				hat: 'still-missing',
				form: 'still-missing',
			},
		});
		snapshot = snapshotAfterTick(server, session);
		own = snapshot.avatars.find(
			(avatar) => avatar.sessionId === session.sessionId,
		);
		expect(own?.cosmetics).toEqual(DEFAULT_COSMETICS);
	});
});

test('malformed frames are isolated and disconnect releases server state', () => {
	const errors: unknown[] = [];
	const { server } = setup({
		logError: (_message, error) => errors.push(error),
	});
	const session = server.connect();
	expect(() => session.send(new Uint8Array([255, 255, 255]))).not.toThrow();
	expect(receive(session)).toEqual([]);
	expect(errors).toHaveLength(1);
	session.disconnect();
	expect(session.closed).toBe(true);
	expect(() => server.advanceTick()).not.toThrow();
});

test('separately constructed runtimes do not share sessions or Handle claims', () => {
	for (const { server } of [setup(), setup()]) {
		const session = server.connect();
		expect(session.sessionId).toBe(1);
		authenticate(session, identity(), 'Independent');
		createAvatar(session, 'Independent');
		expect(snapshotAfterTick(server, session).avatars).toHaveLength(1);
	}
});
