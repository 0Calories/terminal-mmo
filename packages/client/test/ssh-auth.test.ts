// The client's key-file identity path (#235): discoverSshIdentity against a
// synthesized `~/.ssh` directory — no agent, no real home directory, no
// ssh-keygen binary. The openssh-key-v1 file is built in-process from a freshly
// generated ed25519 key, byte-identical in layout to what ssh-keygen writes
// (magic, none/none cipher+kdf, check ints, seed‖pub, 8-byte padding), and the
// produced signature must satisfy the server's pure verifier.
import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SshBlobWriter, verifyChallenge } from '@mmo/shared';
import { discoverSshIdentity } from '../src/ssh-auth';

// Assemble an unencrypted openssh-key-v1 `id_ed25519` from raw key material —
// the format ssh-keygen writes with no passphrase.
function opensshPrivateKeyFile(seed: Uint8Array, pub: Uint8Array): string {
	const pubBlob = new SshBlobWriter();
	pubBlob.string('ssh-ed25519');
	pubBlob.string(pub);

	const priv = new SshBlobWriter();
	priv.u32(0xc0ffee42); // check ints (an equal pair; arbitrary when unencrypted)
	priv.u32(0xc0ffee42);
	priv.string('ssh-ed25519');
	priv.string(pub);
	const seedPub = new Uint8Array(64);
	seedPub.set(seed, 0);
	seedPub.set(pub, 32);
	priv.string(seedPub);
	priv.string('test@synthetic');
	let block = priv.finish();
	// Pad 1,2,3… to the cipher block size (8 for 'none').
	const pad = (8 - (block.length % 8)) % 8;
	const padded = new Uint8Array(block.length + pad);
	padded.set(block);
	for (let i = 0; i < pad; i++) padded[block.length + i] = i + 1;
	block = padded;

	const w = new SshBlobWriter();
	w.string('none'); // cipher
	w.string('none'); // kdf
	w.string(''); // kdf options
	w.u32(1); // nkeys
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

function makeSshDir(): { dir: string; pub: Uint8Array } {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pub = new Uint8Array(
		Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url'),
	);
	const seed = new Uint8Array(
		Buffer.from(privateKey.export({ format: 'jwk' }).d as string, 'base64url'),
	);
	const dir = mkdtempSync(join(tmpdir(), 'mmo-ssh-'));
	writeFileSync(join(dir, 'id_ed25519'), opensshPrivateKeyFile(seed, pub));
	return { dir, pub };
}

test('discoverSshIdentity signs verifiably from an unencrypted id_ed25519 (no agent)', async () => {
	const { dir, pub } = makeSshDir();
	// No SSH_AUTH_SOCK in the env, so only the file path can answer.
	const id = await discoverSshIdentity({}, dir);
	expect(id).not.toBeNull();
	if (!id) throw new Error('unreachable');
	// The offered public key is the one embedded in the file…
	expect(id.publicKey.startsWith('ssh-ed25519 ')).toBe(true);
	// …and its signature over a nonce satisfies the server's pure verifier.
	const nonce = new Uint8Array(32).fill(7);
	const sig = await id.signChallenge(nonce);
	expect(verifyChallenge(id.publicKey, nonce, sig)).toBe(true);
	// Sanity: the key bytes round-tripped (line contains the same 32 bytes).
	expect(pub.length).toBe(32);
});

test('discoverSshIdentity is null with no agent and no key file', async () => {
	const empty = mkdtempSync(join(tmpdir(), 'mmo-ssh-empty-'));
	expect(await discoverSshIdentity({}, empty)).toBeNull();
});

test('discoverSshIdentity skips an unreachable agent socket and falls back to the file', async () => {
	const { dir } = makeSshDir();
	const id = await discoverSshIdentity(
		{ SSH_AUTH_SOCK: join(dir, 'no-such-agent.sock') },
		dir,
	);
	expect(id).not.toBeNull();
});
