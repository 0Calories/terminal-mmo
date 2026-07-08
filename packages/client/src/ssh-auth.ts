// The client half of SSH-key auth (ADR 0004, #235; amendment #297): resolve the
// Player's ed25519 **Identity Key** and sign the server's challenge with it. Nobody
// is ever locked out — a keyless machine mints its own game identity rather than
// refusing. Sources, tried in order:
//
//  1. **The anchored key** (config `identity.anchor`): a returning machine resolves
//     the SAME key it used last, so its public-key-keyed Save can never be orphaned.
//     A `generated` anchor reads the local PKCS8 file (always available); an
//     `external` anchor re-finds that specific SSH key and, if it is momentarily
//     unreachable, yields a NON-destructive refusal — never a freshly minted key.
//  2. **ssh-agent** (SSH_AUTH_SOCK): list identities, pick an ed25519 key —
//     preferring the one matching `~/.ssh/id_ed25519.pub` — and have the agent
//     sign. Works with passphrase-protected and hardware-backed keys, and the
//     private key never touches this process.
//  3. **~/.ssh/id_ed25519 directly**: parse the unencrypted openssh-key-v1 file
//     and sign in-process. A passphrase-protected file is skipped (we will not
//     prompt for a passphrase — that is what the agent is for).
//  4. **Generated fallback** (first launch only, no anchor): mint an ed25519 keypair,
//     store the private key as PKCS8 PEM in the config dir (mode 0600), and play with
//     it. A read-only home degrades to an ephemeral in-memory key with a warning.
//
// Only ssh-ed25519 is supported (the type ADR 0004 names); parsing/encoding of
// the SSH wire formats is shared with the server's pure verifier (@mmo/shared).
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
} from '@mmo/shared';
import { ConfigStore, type IdentityAnchor } from './config';

// What the transport needs: the public key to offer in `hello`, and a signer
// that answers the server's nonce with an agent-format signature blob.
export interface SshIdentity {
	publicKey: string; // OpenSSH one-line form
	signChallenge(nonce: Uint8Array): Promise<Uint8Array>;
}

// Two raw ed25519 keys are the same identity iff their 32 bytes match. Used to
// select the anchored key among the agent's identities and to guard the anchor.
function sameRaw(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// --- ssh-agent (RFC 4251 framing over the unix socket) -----------------------

const AGENTC_REQUEST_IDENTITIES = 11;
const AGENT_IDENTITIES_ANSWER = 12;
const AGENTC_SIGN_REQUEST = 13;
const AGENT_SIGN_RESPONSE = 14;
const AGENT_TIMEOUT_MS = 3000;

// One request/response round-trip with the agent: connect, send the u32
// length-framed body, collect the (also length-framed) reply. Null on any
// failure — no agent, refused socket, timeout, or a short frame. Bun.connect
// (not node:net) because its connection failure is a clean promise rejection,
// where node:net's unix-socket ENOENT escapes as an uncaught error under Bun.
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
					s.end(); // lost the race against the timeout
					return;
				}
				const frame = new SshBlobWriter();
				frame.string(body); // u32 length prefix + body
				s.write(frame.finish());
			},
			() => finish(null),
		);
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

// `wantRaw` pins the selection to a specific key (an anchored external identity):
// when set, ONLY that exact key is returned (null if the agent doesn't hold it), so a
// different loaded key can never silently take over the Save. Without it, the agent's
// key matching `~/.ssh/id_ed25519.pub` is preferred, else its first ed25519 key.
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

// --- ~/.ssh/id_ed25519 (unencrypted openssh-key-v1) --------------------------

// ASN.1 PKCS8 header for an ed25519 private key (RFC 8410): appending the raw
// 32-byte seed yields the DER document node:crypto imports.
const ED25519_PKCS8_PREFIX = Uint8Array.from(
	Buffer.from('302e020100300506032b657004220420', 'hex'),
);
const OPENSSH_MAGIC = 'openssh-key-v1\0';

// `wantRaw`, when set, requires the file to hold that exact key (else null) — the
// anchored-external guard, so a swapped-out `~/.ssh/id_ed25519` can't take over a Save.
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
	if (wantRaw && !sameRaw(pub.key, wantRaw)) return null; // not the anchored key

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
		signChallenge: async (nonce) =>
			encodeSignatureBlob(
				new Uint8Array(sign(null, challengePayload(nonce), keyObject)),
			),
	};
}

// The Player's external SSH identity: ssh-agent first (works with protected keys),
// then the plain `~/.ssh/id_ed25519` file. `wantRaw` pins both sources to a specific
// anchored key. Null when neither yields the wanted (or, unpinned, any) ed25519 key.
async function externalIdentity(
	env: Record<string, string | undefined>,
	sshDir: string,
	wantRaw: Uint8Array | null,
): Promise<SshIdentity | null> {
	if (env.SSH_AUTH_SOCK) {
		try {
			const viaAgent = await agentIdentity(env.SSH_AUTH_SOCK, sshDir, wantRaw);
			if (viaAgent) return viaAgent;
		} catch {
			// fall through to the key file
		}
	}
	try {
		return fileIdentity(sshDir, wantRaw);
	} catch {
		return null;
	}
}

// --- generated fallback identity (ADR 0004 amendment, #297) -------------------

// Build an in-process signer from a PKCS8 PEM ed25519 private key — the generated
// key's storage form (node:crypto's own `generateKeyPairSync` output, NOT an
// openssh-key-v1 file). The public-key line is derived from the raw 32 bytes, the
// same encoder the external paths use, so the server verifies it identically. Null
// (never a throw) for an unreadable / non-ed25519 PEM, so a corrupt file reads as
// "no generated key" rather than crashing the launch.
function identityFromPkcs8(pem: string): SshIdentity | null {
	let priv: ReturnType<typeof createPrivateKey>;
	try {
		priv = createPrivateKey(pem);
	} catch {
		return null;
	}
	if (priv.asymmetricKeyType !== 'ed25519') return null;
	// The Ed25519 private JWK carries the public bytes in `x` (RFC 8037), so the raw
	// public key comes straight off the private key — no separate public KeyObject.
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

// Read the generated Identity Key back from its PKCS8 PEM file. Null when the file
// is missing / unreadable / not an ed25519 key.
function readGeneratedIdentity(keyPath: string): SshIdentity | null {
	let pem: string;
	try {
		pem = readFileSync(keyPath, 'utf8');
	} catch {
		return null;
	}
	return identityFromPkcs8(pem);
}

// Mint a fresh ed25519 identity and try to persist it as PKCS8 PEM at `keyPath`
// (mode 0600, in the config dir). `persisted` is false when the write fails (a
// read-only home): the caller then plays with the in-memory key for this session
// only and warns that progress won't be saved — never a lockout (ADR 0015's
// "failed write degrades to in-memory" applied to the identity).
function mintGeneratedIdentity(keyPath: string): {
	identity: SshIdentity;
	persisted: boolean;
} {
	const { privateKey } = generateKeyPairSync('ed25519');
	const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
	// A freshly generated key always parses, so identityFromPkcs8 can't be null here.
	const identity = identityFromPkcs8(pem) as SshIdentity;
	let persisted = false;
	try {
		mkdirSync(dirname(keyPath), { recursive: true });
		writeFileSync(keyPath, pem, { mode: 0o600 });
		chmodSync(keyPath, 0o600); // enforce 0600 even if the file pre-existed / umask
		persisted = true;
	} catch {
		// read-only home / no perms — fall back to the ephemeral in-memory key.
	}
	return { identity, persisted };
}

// --- the discovery decision (pure) -------------------------------------------

// What discovery decided to do, given the anchor and the resolved candidates —
// separated from the fs/agent IO so the ordering + Save-safety logic is unit-testable.
export type IdentityPlan =
	| { kind: 'external'; writeAnchor: boolean } // use the external key (anchor it iff first launch)
	| { kind: 'generated' } // use the anchored generated key from its file
	| { kind: 'mint' } // first launch, no external key — generate one
	| { kind: 'refuse'; reason: 'external-unreachable' | 'generated-missing' };

// Two OpenSSH public-key lines name the same identity iff their raw key bytes match
// (comment ignored — the account is the key, not the label).
function sameKey(a: string, b: string): boolean {
	const ka = parsePublicKeyLine(a);
	const kb = parsePublicKeyLine(b);
	return !!ka && !!kb && sameRaw(ka.key, kb.key);
}

/**
 * The discovery ordering + Save-safety decision, as a pure function of the anchor
 * and the already-resolved candidates (external SSH key found this launch; the
 * anchored generated key read from disk). The whole invariant lives here:
 *
 *  - An anchored **generated** key resolves from its file; if the file is gone we
 *    REFUSE (its Save is keyed to that public key — minting a new one would orphan it).
 *  - An anchored **external** key must re-appear as the SAME key; unreachable → REFUSE
 *    with recovery guidance, never a fresh mint.
 *  - Only a machine with NO anchor (never had an identity, so no Save to lose) mints:
 *    a real external key wins and is anchored; otherwise a generated key is minted.
 */
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
		// external anchor: the same key must be back, or we refuse (Save-safety).
		if (external && sameKey(external.publicKey, anchor.publicKey))
			return { kind: 'external', writeAnchor: false };
		return { kind: 'refuse', reason: 'external-unreachable' };
	}
	// No anchor — genuine first launch. A real key wins and gets anchored; else mint.
	if (external) return { kind: 'external', writeAnchor: true };
	return { kind: 'mint' };
}

// --- user-facing messages ----------------------------------------------------

// The SSH SHA256 fingerprint of a public-key line (`SHA256:<base64>`), the shape
// `ssh-add -l` prints — so the recovery refusal names the exact key to load.
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

// Non-blocking notice on a generating launch (the only launch that mints a key).
function generatedNotice(keyPath: string): string {
	return `No SSH key found — created a local game identity at ${keyPath}. Keep this file to keep your character.`;
}

// Warning when even the write failed (read-only home): we still play, ephemerally.
const EPHEMERAL_WARNING =
	"Couldn't save a local game identity (is your home directory writable?). " +
	"Playing this session with a temporary key — this character's progress won't be saved.";

// Recovery refusal for an anchored external key that isn't currently loadable. The
// Save is untouched — loading the key and relaunching recovers the same character.
function externalUnreachableRefusal(anchor: IdentityAnchor): string {
	return (
		`This machine last played with SSH key ${fingerprint(anchor.publicKey)}, but it isn't available right now.\n` +
		'Your character is tied to that key, so no new identity was created (your progress is safe).\n' +
		'Load the key and relaunch:  ssh-add   (or start an agent: eval $(ssh-agent) && ssh-add)'
	);
}

// Refusal for an anchored generated key whose file has gone missing. Again
// non-destructive — restoring the file recovers the character.
function generatedMissingRefusal(keyPath: string): string {
	return (
		`This machine's local game identity file (${keyPath}) is missing, so it can't sign in as your character.\n` +
		'No new identity was created (your progress is safe) — restore that file from a backup and relaunch.'
	);
}

// --- discovery -----------------------------------------------------------------

// The result of resolving the Identity Key. `ok` carries the identity plus an
// optional one-line notice (the generated-key notice, or the ephemeral-fallback
// warning) for the caller to surface; `!ok` carries a recovery refusal to print on exit.
export type DiscoveredIdentity =
	| { ok: true; identity: SshIdentity; notice?: string }
	| { ok: false; refusal: string };

/**
 * Resolve the Player's Identity Key (ADR 0004 amendment, #297): the anchored key
 * first (a returning machine always resolves the same account), then a real external
 * SSH key on a first launch, and finally a generated fallback so a keyless machine is
 * never locked out. `config` supplies the anchor and the generated-key path; passing a
 * shared ConfigStore keeps the anchor write in the same in-memory config the rest of
 * the client persists, so a later audio save can't clobber it.
 */
export async function discoverSshIdentity(
	config: ConfigStore = new ConfigStore().load(),
	env: Record<string, string | undefined> = process.env,
	sshDir: string = join(homedir(), '.ssh'),
): Promise<DiscoveredIdentity> {
	const anchor = config.identityAnchor();
	const keyPath = config.identityKeyPath;

	// Resolve the candidates the decision needs. For an external anchor we look for
	// that SPECIFIC key; a generated anchor reads its own file. We only probe the
	// agent/file when it could matter (no anchor, or an external anchor) so a
	// generated player never needs an agent.
	const wantRaw =
		anchor?.source === 'external'
			? (parsePublicKeyLine(anchor.publicKey)?.key ?? null)
			: null;
	const generated =
		anchor?.source === 'generated' ? readGeneratedIdentity(keyPath) : null;
	// Only probe the agent/file when it can matter, and always PINNED for an external
	// anchor: a corrupt anchor line (non-empty but unparseable, so `wantRaw` is null)
	// must not fall back to an unpinned probe that could pick up a different loaded key
	// — it resolves to no external candidate and refuses, keeping the Save safe.
	const external =
		anchor?.source === 'generated'
			? null
			: anchor?.source === 'external' && !wantRaw
				? null
				: await externalIdentity(env, sshDir, wantRaw);

	const plan = planIdentity(anchor, external, generated);
	switch (plan.kind) {
		case 'external': {
			// external is guaranteed non-null by planIdentity for this branch.
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
