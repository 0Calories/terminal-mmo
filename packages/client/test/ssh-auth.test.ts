import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	encodePublicKeyLine,
	SshBlobWriter,
	verifyChallenge,
} from '@mmo/core/persistence';
import { ConfigStore } from '../src/config';
import {
	discoverSshIdentity,
	planIdentity,
	type SshIdentity,
} from '../src/ssh-auth';

function opensshPrivateKeyFile(seed: Uint8Array, pub: Uint8Array): string {
	const pubBlob = new SshBlobWriter();
	pubBlob.string('ssh-ed25519');
	pubBlob.string(pub);

	const priv = new SshBlobWriter();
	priv.u32(0xc0ffee42); // check ints: an equal pair, arbitrary when unencrypted
	priv.u32(0xc0ffee42);
	priv.string('ssh-ed25519');
	priv.string(pub);
	const seedPub = new Uint8Array(64);
	seedPub.set(seed, 0);
	seedPub.set(pub, 32);
	priv.string(seedPub);
	priv.string('test@synthetic');
	let block = priv.finish();
	// pad 1,2,3… to the 8-byte cipher block
	const pad = (8 - (block.length % 8)) % 8;
	const padded = new Uint8Array(block.length + pad);
	padded.set(block);
	for (let i = 0; i < pad; i++) padded[block.length + i] = i + 1;
	block = padded;

	const w = new SshBlobWriter();
	w.string('none');
	w.string('none');
	w.string('');
	w.u32(1);
	w.string(pubBlob.finish());
	w.string(block);

	const magic = new TextEncoder().encode('openssh-key-v1\0');
	const body = new Uint8Array(magic.length + w.finish().length);
	body.set(magic);
	body.set(w.finish(), magic.length);
	const b64 = Buffer.from(body).toString('base64');
	const lines = b64.match(/.{1,70}/g) ?? [];
	return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function freshKey(): { pub: Uint8Array; seed: Uint8Array } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pub = new Uint8Array(
		Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url'),
	);
	const seed = new Uint8Array(
		Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64url'),
	);
	return { pub, seed };
}

function makeSshDir(): { dir: string; pub: Uint8Array } {
	const { pub, seed } = freshKey();
	const dir = mkdtempSync(join(tmpdir(), 'mmo-ssh-'));
	writeFileSync(join(dir, 'id_ed25519'), opensshPrivateKeyFile(seed, pub));
	return { dir, pub };
}

function emptySshDir(): string {
	return mkdtempSync(join(tmpdir(), 'mmo-ssh-empty-'));
}
function tmpConfig(): ConfigStore {
	const dir = mkdtempSync(join(tmpdir(), 'mmo-cfg-'));
	return new ConfigStore(join(dir, 'config.json')).load();
}

function fakeIdentity(publicKey: string): SshIdentity {
	return { publicKey, signChallenge: async () => new Uint8Array() };
}

test('discoverSshIdentity signs verifiably from an unencrypted id_ed25519 and anchors it external', async () => {
	const { dir } = makeSshDir();
	const config = tmpConfig();
	const res = await discoverSshIdentity(config, {}, dir);
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable');
	expect(res.identity.publicKey.startsWith('ssh-ed25519 ')).toBe(true);
	const nonce = new Uint8Array(32).fill(7);
	const sig = await res.identity.signChallenge(nonce);
	expect(verifyChallenge(res.identity.publicKey, nonce, sig)).toBe(true);
	expect(res.notice).toBeUndefined();
	const anchor = config.identityAnchor();
	expect(anchor).toEqual({
		publicKey: res.identity.publicKey,
		source: 'external',
	});
	expect(existsSync(config.identityKeyPath)).toBe(false);
});

test('discoverSshIdentity skips an unreachable agent socket and falls back to the file', async () => {
	const { dir } = makeSshDir();
	const res = await discoverSshIdentity(
		tmpConfig(),
		{ SSH_AUTH_SOCK: join(dir, 'no-such-agent.sock') },
		dir,
	);
	expect(res.ok).toBe(true);
});

test('a keyless first launch mints a generated identity, anchors it, and relaunches to the same key', async () => {
	const config = tmpConfig();
	const sshDir = emptySshDir();
	const res = await discoverSshIdentity(config, {}, sshDir);
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable');
	expect(res.notice).toContain('created a local game identity');
	const nonce = new Uint8Array(32).fill(3);
	const sig = await res.identity.signChallenge(nonce);
	expect(verifyChallenge(res.identity.publicKey, nonce, sig)).toBe(true);
	const keyPath = config.identityKeyPath;
	expect(keyPath).toBe(join(dirname(config.path), 'id_ed25519'));
	expect(existsSync(keyPath)).toBe(true);
	expect(statSync(keyPath).mode & 0o777).toBe(0o600);
	expect(config.identityAnchor()).toEqual({
		publicKey: res.identity.publicKey,
		source: 'generated',
	});
	const relaunch = await discoverSshIdentity(
		new ConfigStore(config.path).load(),
		{},
		emptySshDir(),
	);
	expect(relaunch.ok).toBe(true);
	if (!relaunch.ok) throw new Error('unreachable');
	expect(relaunch.identity.publicKey).toBe(res.identity.publicKey);
	expect(relaunch.notice).toBeUndefined();
});

test('an anchored external key that is unreachable refuses WITHOUT minting a new key', async () => {
	const config = tmpConfig();
	const { pub } = freshKey();
	const line = encodePublicKeyLine(pub);
	config.saveIdentityAnchor({ publicKey: line, source: 'external' });
	const res = await discoverSshIdentity(config, {}, emptySshDir());
	expect(res.ok).toBe(false);
	if (res.ok) throw new Error('unreachable');
	expect(res.refusal).toContain('ssh-add');
	expect(existsSync(config.identityKeyPath)).toBe(false);
	expect(new ConfigStore(config.path).load().identityAnchor()).toEqual({
		publicKey: line,
		source: 'external',
	});
});

test('a read-only home degrades to an ephemeral in-memory key with a warning, no lockout', async () => {
	// parent is a file, so key-file and anchor writes both throw (stands in for a read-only home)
	const dir = mkdtempSync(join(tmpdir(), 'mmo-ro-'));
	const filePath = join(dir, 'afile');
	writeFileSync(filePath, 'x');
	const config = new ConfigStore(join(filePath, 'config.json')).load();
	const res = await discoverSshIdentity(config, {}, emptySshDir());
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable');
	expect(res.notice).toContain("won't be saved");
	const nonce = new Uint8Array(32).fill(9);
	const sig = await res.identity.signChallenge(nonce);
	expect(verifyChallenge(res.identity.publicKey, nonce, sig)).toBe(true);
	expect(existsSync(config.identityKeyPath)).toBe(false);
});

test('MMO_GUEST=1 yields an ok identity with a notice and never writes the config anchor', async () => {
	const config = tmpConfig();
	const res = await discoverSshIdentity(
		config,
		{ MMO_GUEST: '1' },
		emptySshDir(),
	);
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable');
	expect(res.notice).toContain('throwaway guest identity');
	expect(config.identityAnchor()).toBeNull();
	expect(existsSync(config.identityKeyPath)).toBe(false);
});

test('MMO_GUEST mints a different key on every launch', async () => {
	const a = await discoverSshIdentity(
		tmpConfig(),
		{ MMO_GUEST: '1' },
		emptySshDir(),
	);
	const b = await discoverSshIdentity(
		tmpConfig(),
		{ MMO_GUEST: '1' },
		emptySshDir(),
	);
	if (!a.ok || !b.ok) throw new Error('unreachable');
	expect(a.identity.publicKey).not.toBe(b.identity.publicKey);
});

test('MMO_GUEST bypasses an anchored-but-unavailable external key that would otherwise refuse', async () => {
	const config = tmpConfig();
	const { pub } = freshKey();
	config.saveIdentityAnchor({
		publicKey: encodePublicKeyLine(pub),
		source: 'external',
	});
	const res = await discoverSshIdentity(
		config,
		{ MMO_GUEST: '1' },
		emptySshDir(),
	);
	expect(res.ok).toBe(true);
});

test('MMO_GUEST identity can sign a verifiable challenge', async () => {
	const res = await discoverSshIdentity(
		tmpConfig(),
		{ MMO_GUEST: '1' },
		emptySshDir(),
	);
	if (!res.ok) throw new Error('unreachable');
	const nonce = new Uint8Array(32).fill(5);
	const sig = await res.identity.signChallenge(nonce);
	expect(verifyChallenge(res.identity.publicKey, nonce, sig)).toBe(true);
});

test('MMO_GUEST unset follows the normal path and mints/anchors a generated identity', async () => {
	const config = tmpConfig();
	const res = await discoverSshIdentity(config, {}, emptySshDir());
	expect(res.ok).toBe(true);
	if (!res.ok) throw new Error('unreachable');
	expect(res.notice).toContain('created a local game identity');
	expect(config.identityAnchor()).toEqual({
		publicKey: res.identity.publicKey,
		source: 'generated',
	});
});

test('planIdentity: no anchor + an external key uses it and anchors it', () => {
	const ext = fakeIdentity('ssh-ed25519 AAAA');
	expect(planIdentity(null, ext, null)).toEqual({
		kind: 'external',
		writeAnchor: true,
	});
});

test('planIdentity: no anchor + no external key mints a generated identity', () => {
	expect(planIdentity(null, null, null)).toEqual({ kind: 'mint' });
});

test('planIdentity: a generated anchor resolves from its file, or refuses when missing', () => {
	const gen = fakeIdentity('ssh-ed25519 GEN');
	const anchor = { publicKey: 'ssh-ed25519 GEN', source: 'generated' as const };
	expect(planIdentity(anchor, null, gen)).toEqual({ kind: 'generated' });
	expect(planIdentity(anchor, null, null)).toEqual({
		kind: 'refuse',
		reason: 'generated-missing',
	});
});

test('planIdentity: an external anchor uses the SAME key, and never re-anchors it', () => {
	const { pub } = freshKey();
	const line = encodePublicKeyLine(pub, 'a-comment');
	const anchor = {
		publicKey: encodePublicKeyLine(pub),
		source: 'external' as const,
	};
	// a returning key with a different comment is still the same identity
	expect(planIdentity(anchor, fakeIdentity(line), null)).toEqual({
		kind: 'external',
		writeAnchor: false,
	});
});

test('planIdentity: an unreachable external anchor refuses without minting', () => {
	const anchor = { publicKey: 'ssh-ed25519 WANT', source: 'external' as const };
	expect(planIdentity(anchor, null, null)).toEqual({
		kind: 'refuse',
		reason: 'external-unreachable',
	});
});

test('planIdentity: a DIFFERENT external key does not satisfy an external anchor (Save-safety)', () => {
	const wanted = freshKey();
	const other = freshKey();
	const anchor = {
		publicKey: encodePublicKeyLine(wanted.pub),
		source: 'external' as const,
	};
	expect(
		planIdentity(anchor, fakeIdentity(encodePublicKeyLine(other.pub)), null),
	).toEqual({ kind: 'refuse', reason: 'external-unreachable' });
});
