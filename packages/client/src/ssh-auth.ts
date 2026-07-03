// The client half of SSH-key auth (ADR 0004, #235): find the Player's ed25519
// identity and sign the server's challenge with it. Two sources, tried in order:
//
//  1. **ssh-agent** (SSH_AUTH_SOCK): list identities, pick an ed25519 key —
//     preferring the one matching `~/.ssh/id_ed25519.pub` — and have the agent
//     sign. Works with passphrase-protected and hardware-backed keys, and the
//     private key never touches this process.
//  2. **~/.ssh/id_ed25519 directly**: parse the unencrypted openssh-key-v1 file
//     and sign in-process. A passphrase-protected file is skipped (we will not
//     prompt for a passphrase — that is what the agent is for).
//
// Only ssh-ed25519 is supported (the type ADR 0004 names); parsing/encoding of
// the SSH wire formats is shared with the server's pure verifier (@mmo/shared).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	challengePayload,
	encodePublicKeyLine,
	encodeSignatureBlob,
	parsePublicKeyBlob,
	parsePublicKeyLine,
	SSH_ED25519,
	SshBlobReader,
	SshBlobWriter,
} from '@mmo/shared';

// What the transport needs: the public key to offer in `hello`, and a signer
// that answers the server's nonce with an agent-format signature blob.
export interface SshIdentity {
	publicKey: string; // OpenSSH one-line form
	source: 'agent' | 'file';
	signChallenge(nonce: Uint8Array): Promise<Uint8Array>;
}

// --- ssh-agent (RFC 4251 framing over the unix socket) -----------------------

const AGENTC_REQUEST_IDENTITIES = 11;
const AGENT_IDENTITIES_ANSWER = 12;
const AGENTC_SIGN_REQUEST = 13;
const AGENT_SIGN_RESPONSE = 14;
const AGENT_TIMEOUT_MS = 3000;

// One request/response round-trip with the agent: connect, send the u32
// length-framed body, collect the (also length-framed) reply. Null on any
// failure — no agent, refused socket, timeout, or a short frame.
function agentRoundTrip(
	sockPath: string,
	body: Uint8Array,
): Promise<Uint8Array | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let done = false;
		const finish = (result: Uint8Array | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			sock.destroy();
			resolve(result);
		};
		const timer = setTimeout(() => finish(null), AGENT_TIMEOUT_MS);
		const sock = connect({ path: sockPath });
		sock.on('error', () => finish(null));
		sock.on('connect', () => {
			const frame = new SshBlobWriter();
			frame.string(body); // u32 length prefix + body
			sock.write(frame.finish());
		});
		sock.on('data', (chunk) => {
			chunks.push(Buffer.from(chunk));
			const buf = Buffer.concat(chunks);
			if (buf.length < 4) return;
			const len = buf.readUInt32BE(0);
			if (buf.length < 4 + len) return;
			finish(new Uint8Array(buf.subarray(4, 4 + len)));
		});
		sock.on('close', () => finish(null));
	});
}

interface AgentKey {
	blob: Uint8Array; // the raw public-key blob (what sign requests are keyed by)
	raw: Uint8Array; // the 32 ed25519 key bytes inside it
	comment: string;
}

// The agent's ed25519 identities, in its order. Null if the agent is
// unreachable; empty if it answered with no usable key.
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
		if (blob === null || comment === null) return keys; // short frame; keep what parsed
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

// Ask the agent to sign `payload` with the key identified by `blob`. The reply's
// signature field is already the {algo, sig} blob the server verifies.
async function agentSign(
	sockPath: string,
	blob: Uint8Array,
	payload: Uint8Array,
): Promise<Uint8Array> {
	const w = new SshBlobWriter();
	w.u8(AGENTC_SIGN_REQUEST);
	w.string(blob);
	w.string(payload);
	w.u32(0); // flags: none (ed25519 has no rsa-sha2-style variants)
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

// The raw key bytes of `~/.ssh/id_ed25519.pub`, to prefer that identity among
// the agent's keys. Null when the file is missing/unreadable/not ed25519.
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
): Promise<SshIdentity | null> {
	const keys = await agentEd25519Keys(sockPath);
	if (!keys || keys.length === 0) return null;
	const preferred = defaultPubKeyRaw(sshDir);
	const match = preferred
		? keys.find(
				(k) =>
					k.raw.length === preferred.length &&
					k.raw.every((b, i) => b === preferred[i]),
			)
		: undefined;
	const chosen = match ?? keys[0];
	return {
		publicKey: encodePublicKeyLine(chosen.raw, chosen.comment || undefined),
		source: 'agent',
		signChallenge: (nonce) =>
			agentSign(sockPath, chosen.blob, challengePayload(nonce)),
	};
}

// --- ~/.ssh/id_ed25519 (unencrypted openssh-key-v1) --------------------------

// ASN.1 PKCS8 header for an ed25519 private key (RFC 8410): appending the raw
// 32-byte seed yields the DER document node:crypto imports.
const ED25519_PKCS8_PREFIX = Uint8Array.from(
	Buffer.from('302e020100300506032b657004220420', 'hex'),
);
const OPENSSH_MAGIC = 'openssh-key-v1\0';

function fileIdentity(sshDir: string): SshIdentity | null {
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
	r.string(); // kdf options
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
	// A passphrase-protected file is skipped, not decrypted: the agent path is
	// the supported way to use a protected key.
	if (new TextDecoder().decode(cipher) !== 'none') return null;
	const pub = parsePublicKeyBlob(pubBlob);
	if (!pub) return null; // not an ed25519 key

	const pr = new SshBlobReader(privBlock);
	pr.u32(); // check bytes (equal pair; unencrypted, so no need to compare)
	pr.u32();
	const algo = pr.string();
	pr.string(); // public key again
	const priv = pr.string(); // 64 bytes: seed || public
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
		source: 'file',
		signChallenge: async (nonce) =>
			encodeSignatureBlob(
				new Uint8Array(sign(null, challengePayload(nonce), keyObject)),
			),
	};
}

// --- discovery -----------------------------------------------------------------

/**
 * The Player's SSH identity: ssh-agent first (works with protected keys),
 * then the plain `~/.ssh/id_ed25519` file. Null when neither yields an ed25519
 * key — the caller prints actionable guidance and exits.
 */
export async function discoverSshIdentity(
	env: Record<string, string | undefined> = process.env,
	sshDir: string = join(homedir(), '.ssh'),
): Promise<SshIdentity | null> {
	if (env.SSH_AUTH_SOCK) {
		try {
			const viaAgent = await agentIdentity(env.SSH_AUTH_SOCK, sshDir);
			if (viaAgent) return viaAgent;
		} catch {
			// fall through to the key file
		}
	}
	try {
		return fileIdentity(sshDir);
	} catch {
		return null;
	}
}

// Actionable guidance for a launch with no usable key, printed on exit.
export const NO_KEY_HINT =
	'No usable SSH key found. terminal-mmo authenticates with your SSH ed25519 key (no passwords):\n' +
	'  • have an agent running: eval $(ssh-agent) && ssh-add   — or —\n' +
	'  • create a key: ssh-keygen -t ed25519';
