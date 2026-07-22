import {
	createHash,
	createPrivateKey,
	generateKeyPairSync,
	sign,
} from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	challengePayload,
	encodePublicKeyLine,
	encodeSignatureBlob,
	parsePublicKeyBlob,
	parsePublicKeyLine,
	SSH_ED25519,
	SshBlobReader,
	SshBlobWriter,
} from '@mmo/core/persistence';
import { ConfigStore, type IdentityAnchor } from './config';

export interface SshIdentity {
	publicKey: string;
	signChallenge(nonce: Uint8Array): Promise<Uint8Array>;
}

function sameRaw(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const AGENTC_REQUEST_IDENTITIES = 11;
const AGENT_IDENTITIES_ANSWER = 12;
const AGENTC_SIGN_REQUEST = 13;
const AGENT_SIGN_RESPONSE = 14;
const AGENT_TIMEOUT_MS = 3000;

// Bun.connect, not node:net: node:net's unix-socket ENOENT escapes as an uncaught error under Bun.
function agentRoundTrip(
	sockPath: string,
	body: Uint8Array,
): Promise<Uint8Array | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let done = false;
		let sock: Bun.Socket | null = null;
		const finish = (result: Uint8Array | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			sock?.end();
			resolve(result);
		};
		const timer = setTimeout(() => finish(null), AGENT_TIMEOUT_MS);
		Bun.connect({
			unix: sockPath,
			socket: {
				data(_s, chunk) {
					chunks.push(Buffer.from(chunk));
					const buf = Buffer.concat(chunks);
					if (buf.length < 4) return;
					const len = buf.readUInt32BE(0);
					if (buf.length < 4 + len) return;
					finish(new Uint8Array(buf.subarray(4, 4 + len)));
				},
				error() {
					finish(null);
				},
				close() {
					finish(null);
				},
			},
		}).then(
			(s) => {
				sock = s;
				if (done) {
					s.end();
					return;
				}
				const frame = new SshBlobWriter();
				frame.string(body);
				s.write(frame.finish());
			},
			() => finish(null),
		);
	});
}

interface AgentKey {
	blob: Uint8Array;
	raw: Uint8Array;
	comment: string;
}

async function agentEd25519Keys(sockPath: string): Promise<AgentKey[] | null> {
	const reply = await agentRoundTrip(
		sockPath,
		Uint8Array.of(AGENTC_REQUEST_IDENTITIES),
	);
	if (!reply) return null;
	const r = new SshBlobReader(reply);
	if (r.u8() !== AGENT_IDENTITIES_ANSWER) return null;
	const n = r.u32();
	if (n === null) return null;
	const keys: AgentKey[] = [];
	for (let i = 0; i < n; i++) {
		const blob = r.string();
		const comment = r.string();
		if (blob === null || comment === null) return keys;
		const pub = parsePublicKeyBlob(blob);
		if (pub)
			keys.push({
				blob,
				raw: pub.key,
				comment: new TextDecoder().decode(comment),
			});
	}
	return keys;
}

async function agentSign(
	sockPath: string,
	blob: Uint8Array,
	payload: Uint8Array,
): Promise<Uint8Array> {
	const w = new SshBlobWriter();
	w.u8(AGENTC_SIGN_REQUEST);
	w.string(blob);
	w.string(payload);
	w.u32(0);
	const reply = await agentRoundTrip(sockPath, w.finish());
	if (!reply) throw new Error('ssh-agent did not answer the sign request');
	const r = new SshBlobReader(reply);
	if (r.u8() !== AGENT_SIGN_RESPONSE)
		throw new Error(
			'ssh-agent refused to sign (is the key still loaded? try `ssh-add`)',
		);
	const sig = r.string();
	if (sig === null) throw new Error('ssh-agent returned a malformed signature');
	return sig;
}

function defaultPubKeyRaw(sshDir: string): Uint8Array | null {
	try {
		const line = readFileSync(join(sshDir, 'id_ed25519.pub'), 'utf8');
		return parsePublicKeyLine(line)?.key ?? null;
	} catch {
		return null;
	}
}

async function agentIdentity(
	sockPath: string,
	sshDir: string,
	wantRaw?: Uint8Array | null,
): Promise<SshIdentity | null> {
	const keys = await agentEd25519Keys(sockPath);
	if (!keys || keys.length === 0) return null;
	let chosen: AgentKey | undefined;
	if (wantRaw) {
		chosen = keys.find((k) => sameRaw(k.raw, wantRaw));
		if (!chosen) return null;
	} else {
		const preferred = defaultPubKeyRaw(sshDir);
		const match = preferred
			? keys.find((k) => sameRaw(k.raw, preferred))
			: undefined;
		chosen = match ?? keys[0];
	}
	return {
		publicKey: encodePublicKeyLine(chosen.raw, chosen.comment || undefined),
		signChallenge: (nonce) =>
			agentSign(sockPath, chosen.blob, challengePayload(nonce)),
	};
}

const ED25519_PKCS8_PREFIX = Uint8Array.from(
	Buffer.from('302e020100300506032b657004220420', 'hex'),
);
const OPENSSH_MAGIC = 'openssh-key-v1\0';

function fileIdentity(
	sshDir: string,
	wantRaw?: Uint8Array | null,
): SshIdentity | null {
	let pem: string;
	try {
		pem = readFileSync(join(sshDir, 'id_ed25519'), 'utf8');
	} catch {
		return null;
	}
	const body = pem
		.split('\n')
		.filter((l) => l && !l.startsWith('-----'))
		.join('');
	let bin: Buffer;
	try {
		bin = Buffer.from(body, 'base64');
	} catch {
		return null;
	}
	if (
		bin.length < OPENSSH_MAGIC.length ||
		bin.toString('latin1', 0, OPENSSH_MAGIC.length) !== OPENSSH_MAGIC
	)
		return null;
	const r = new SshBlobReader(
		new Uint8Array(bin.subarray(OPENSSH_MAGIC.length)),
	);
	const cipher = r.string();
	const kdf = r.string();
	r.string();
	const nkeys = r.u32();
	const pubBlob = r.string();
	const privBlock = r.string();
	if (
		cipher === null ||
		kdf === null ||
		nkeys === null ||
		pubBlob === null ||
		privBlock === null
	)
		return null;

	if (new TextDecoder().decode(cipher) !== 'none') return null;
	const pub = parsePublicKeyBlob(pubBlob);
	if (!pub) return null;
	if (wantRaw && !sameRaw(pub.key, wantRaw)) return null;

	const pr = new SshBlobReader(privBlock);
	pr.u32();
	pr.u32();
	const algo = pr.string();
	pr.string();
	const priv = pr.string();
	if (
		algo === null ||
		priv === null ||
		new TextDecoder().decode(algo) !== SSH_ED25519 ||
		priv.length !== 64
	)
		return null;
	const der = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
	der.set(ED25519_PKCS8_PREFIX, 0);
	der.set(priv.subarray(0, 32), ED25519_PKCS8_PREFIX.length);
	const keyObject = createPrivateKey({
		key: Buffer.from(der),
		format: 'der',
		type: 'pkcs8',
	});
	return {
		publicKey: encodePublicKeyLine(pub.key),
		signChallenge: async (nonce) =>
			encodeSignatureBlob(
				new Uint8Array(sign(null, challengePayload(nonce), keyObject)),
			),
	};
}

async function externalIdentity(
	env: Record<string, string | undefined>,
	sshDir: string,
	wantRaw: Uint8Array | null,
): Promise<SshIdentity | null> {
	if (env.SSH_AUTH_SOCK) {
		try {
			const viaAgent = await agentIdentity(env.SSH_AUTH_SOCK, sshDir, wantRaw);
			if (viaAgent) return viaAgent;
		} catch {}
	}
	try {
		return fileIdentity(sshDir, wantRaw);
	} catch {
		return null;
	}
}

function identityFromPkcs8(pem: string): SshIdentity | null {
	let priv: ReturnType<typeof createPrivateKey>;
	try {
		priv = createPrivateKey(pem);
	} catch {
		return null;
	}
	if (priv.asymmetricKeyType !== 'ed25519') return null;

	const jwk = priv.export({ format: 'jwk' }) as { x?: string };
	if (!jwk.x) return null;
	const raw = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
	if (raw.length !== 32) return null;
	return {
		publicKey: encodePublicKeyLine(raw),
		signChallenge: async (nonce) =>
			encodeSignatureBlob(
				new Uint8Array(sign(null, challengePayload(nonce), priv)),
			),
	};
}

function readGeneratedIdentity(keyPath: string): SshIdentity | null {
	let pem: string;
	try {
		pem = readFileSync(keyPath, 'utf8');
	} catch {
		return null;
	}
	return identityFromPkcs8(pem);
}

function mintGeneratedIdentity(keyPath: string): {
	identity: SshIdentity;
	persisted: boolean;
} {
	const { privateKey } = generateKeyPairSync('ed25519');
	const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;

	const identity = identityFromPkcs8(pem) as SshIdentity;
	let persisted = false;
	try {
		mkdirSync(dirname(keyPath), { recursive: true });
		writeFileSync(keyPath, pem, { mode: 0o600 });
		chmodSync(keyPath, 0o600);
		persisted = true;
	} catch {}
	return { identity, persisted };
}

export type IdentityPlan =
	| { kind: 'external'; writeAnchor: boolean }
	| { kind: 'generated' }
	| { kind: 'mint' }
	| { kind: 'refuse'; reason: 'external-unreachable' | 'generated-missing' };

function sameKey(a: string, b: string): boolean {
	const ka = parsePublicKeyLine(a);
	const kb = parsePublicKeyLine(b);
	return !!ka && !!kb && sameRaw(ka.key, kb.key);
}

// Save-safety: an anchored key must reappear or we REFUSE — only an unanchored machine mints.
export function planIdentity(
	anchor: IdentityAnchor | null,
	external: SshIdentity | null,
	generated: SshIdentity | null,
): IdentityPlan {
	if (anchor) {
		if (anchor.source === 'generated')
			return generated
				? { kind: 'generated' }
				: { kind: 'refuse', reason: 'generated-missing' };
		if (external && sameKey(external.publicKey, anchor.publicKey))
			return { kind: 'external', writeAnchor: false };
		return { kind: 'refuse', reason: 'external-unreachable' };
	}
	if (external) return { kind: 'external', writeAnchor: true };
	return { kind: 'mint' };
}

function fingerprint(publicKey: string): string {
	const parsed = parsePublicKeyLine(publicKey);
	if (!parsed) return '(unknown key)';
	const blob = new SshBlobWriter();
	blob.string(SSH_ED25519);
	blob.string(parsed.key);
	const digest = createHash('sha256')
		.update(blob.finish())
		.digest('base64')
		.replace(/=+$/, '');
	return `SHA256:${digest}`;
}

function generatedNotice(keyPath: string): string {
	return `No SSH key found — created a local game identity at ${keyPath}. Keep this file to keep your character.`;
}

const EPHEMERAL_WARNING =
	"Couldn't save a local game identity (is your home directory writable?). " +
	"Playing this session with a temporary key — this character's progress won't be saved.";

function externalUnreachableRefusal(anchor: IdentityAnchor): string {
	return (
		`This machine last played with SSH key ${fingerprint(anchor.publicKey)}, but it isn't available right now.\n` +
		'Your character is tied to that key, so no new identity was created (your progress is safe).\n' +
		'Load the key and relaunch:  ssh-add   (or start an agent: eval $(ssh-agent) && ssh-add)'
	);
}

function generatedMissingRefusal(keyPath: string): string {
	return (
		`This machine's local game identity file (${keyPath}) is missing, so it can't sign in as your character.\n` +
		'No new identity was created (your progress is safe) — restore that file from a backup and relaunch.'
	);
}

export type DiscoveredIdentity =
	| { ok: true; identity: SshIdentity; notice?: string }
	| { ok: false; refusal: string };

const GUEST_NOTICE =
	'MMO_GUEST: playing as a throwaway guest identity — this character will not be saved.';

export async function discoverSshIdentity(
	config: ConfigStore = new ConfigStore().load(),
	env: Record<string, string | undefined> = process.env,
	sshDir: string = join(homedir(), '.ssh'),
): Promise<DiscoveredIdentity> {
	if (env.MMO_GUEST && env.MMO_GUEST !== '0') {
		const { privateKey } = generateKeyPairSync('ed25519');
		const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;

		const identity = identityFromPkcs8(pem) as SshIdentity;
		return { ok: true, identity, notice: GUEST_NOTICE };
	}

	const anchor = config.identityAnchor();
	const keyPath = config.identityKeyPath;

	const wantRaw =
		anchor?.source === 'external'
			? (parsePublicKeyLine(anchor.publicKey)?.key ?? null)
			: null;
	const generated =
		anchor?.source === 'generated' ? readGeneratedIdentity(keyPath) : null;

	const external =
		anchor?.source === 'generated'
			? null
			: anchor?.source === 'external' && !wantRaw
				? null
				: await externalIdentity(env, sshDir, wantRaw);

	const plan = planIdentity(anchor, external, generated);
	switch (plan.kind) {
		case 'external': {
			const identity = external as SshIdentity;
			if (plan.writeAnchor)
				config.saveIdentityAnchor({
					publicKey: identity.publicKey,
					source: 'external',
				});
			return { ok: true, identity };
		}
		case 'generated':
			return { ok: true, identity: generated as SshIdentity };
		case 'mint': {
			const { identity, persisted } = mintGeneratedIdentity(keyPath);
			if (!persisted) return { ok: true, identity, notice: EPHEMERAL_WARNING };
			config.saveIdentityAnchor({
				publicKey: identity.publicKey,
				source: 'generated',
			});
			return { ok: true, identity, notice: generatedNotice(keyPath) };
		}
		case 'refuse':
			return {
				ok: false,
				refusal:
					plan.reason === 'generated-missing'
						? generatedMissingRefusal(keyPath)
						: externalUnreachableRefusal(anchor as IdentityAnchor),
			};
	}
}
