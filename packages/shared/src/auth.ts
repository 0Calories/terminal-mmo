// SSH-key challenge-response auth (ADR 0004, #235). Everything here is pure and
// socket-free: SSH wire-format parsing, the ed25519 signature verifier, and the
// username-claim registry that makes the Handle a durable identity (one public
// key ↔ one unique username). The server wires these to its WebSocket handshake;
// the client reuses the format helpers to talk to ssh-agent. Only ssh-ed25519 is
// supported — the key type ADR 0004 names, and the modern default — so a Player
// with only an RSA key gets a clear refusal, not a protocol error.
//
// node:crypto is used for the ed25519 verify only: deterministic and IO-free, so
// the shared package's purity contract holds (both runtimes are Bun).
import { createPublicKey, verify } from 'node:crypto';

export const SSH_ED25519 = 'ssh-ed25519';
const ED25519_KEY_LEN = 32;
const ED25519_SIG_LEN = 64;
// ASN.1 SPKI header for an ed25519 public key: appending the raw 32 key bytes
// yields the DER document node:crypto imports. Fixed by RFC 8410, so it is a
// constant rather than an ASN.1 dependency.
const ED25519_SPKI_PREFIX = Uint8Array.from(
	Buffer.from('302a300506032b6570032100', 'hex'),
);

export interface SshPublicKey {
	algo: typeof SSH_ED25519;
	key: Uint8Array; // the raw 32-byte ed25519 public key
	comment?: string;
}

// --- SSH wire blobs (RFC 4251: u32 big-endian ints, length-prefixed strings) ---
// Exported because the client's ssh-agent conversation (and its id_ed25519
// parser) speak the exact same primitive encoding.

export class SshBlobWriter {
	private chunks: Uint8Array[] = [];

	u8(v: number) {
		this.chunks.push(Uint8Array.of(v));
	}

	u32(v: number) {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, v);
		this.chunks.push(b);
	}

	string(bytes: Uint8Array | string) {
		const b =
			typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
		this.u32(b.length);
		this.chunks.push(b);
	}

	finish(): Uint8Array {
		const total = this.chunks.reduce((n, c) => n + c.length, 0);
		const out = new Uint8Array(total);
		let pos = 0;
		for (const c of this.chunks) {
			out.set(c, pos);
			pos += c.length;
		}
		return out;
	}
}

// Every read returns null on a short / malformed buffer rather than throwing —
// both sides feed these untrusted input.
export class SshBlobReader {
	private pos = 0;
	constructor(private buf: Uint8Array) {}

	u8(): number | null {
		if (this.pos + 1 > this.buf.length) return null;
		return this.buf[this.pos++];
	}

	u32(): number | null {
		if (this.pos + 4 > this.buf.length) return null;
		const view = new DataView(
			this.buf.buffer,
			this.buf.byteOffset,
			this.buf.byteLength,
		);
		const v = view.getUint32(this.pos);
		this.pos += 4;
		return v;
	}

	string(): Uint8Array | null {
		const len = this.u32();
		if (len === null || this.pos + len > this.buf.length) return null;
		const out = this.buf.subarray(this.pos, this.pos + len);
		this.pos += len;
		return out;
	}
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

// --- public keys ---------------------------------------------------------------

// The base64 payload of an OpenSSH public-key line is itself a blob:
// { string algo, string key }. Null for anything but a well-formed ssh-ed25519.
export function parsePublicKeyBlob(blob: Uint8Array): SshPublicKey | null {
	const r = new SshBlobReader(blob);
	const algo = r.string();
	const key = r.string();
	if (algo === null || key === null) return null;
	if (utf8(algo) !== SSH_ED25519 || key.length !== ED25519_KEY_LEN) return null;
	return { algo: SSH_ED25519, key };
}

// Parse an OpenSSH one-line public key — `ssh-ed25519 <base64> [comment]`, the
// format of `~/.ssh/id_ed25519.pub` — into its raw key. Null (never a throw) for
// any other key type or malformed line: the server feeds this untrusted input.
export function parsePublicKeyLine(line: string): SshPublicKey | null {
	const parts = line.trim().split(/\s+/);
	if (parts.length < 2 || parts[0] !== SSH_ED25519) return null;
	let blob: Buffer;
	try {
		blob = Buffer.from(parts[1], 'base64');
	} catch {
		return null;
	}
	// Buffer.from('!!!', 'base64') silently drops bad chars; require the decode to
	// round-trip so a garbled field can't alias a shorter valid blob.
	if (
		blob.toString('base64').replace(/=+$/, '') !== parts[1].replace(/=+$/, '')
	)
		return null;
	const parsed = parsePublicKeyBlob(new Uint8Array(blob));
	if (!parsed) return null;
	const comment = parts.slice(2).join(' ');
	return comment ? { ...parsed, comment } : parsed;
}

// The canonical registry key for a public key: algo + base64 blob, comment
// stripped — so the same key registered from different machines (different
// comments) is one identity.
export function canonicalPublicKey(k: SshPublicKey): string {
	const w = new SshBlobWriter();
	w.string(SSH_ED25519);
	w.string(k.key);
	return `${SSH_ED25519} ${Buffer.from(w.finish()).toString('base64')}`;
}

// Build the one-line OpenSSH form from a raw 32-byte ed25519 key — the client's
// side of the handshake, and test scaffolding.
export function encodePublicKeyLine(raw: Uint8Array, comment?: string): string {
	const line = canonicalPublicKey({ algo: SSH_ED25519, key: raw });
	return comment ? `${line} ${comment}` : line;
}

// --- signatures -----------------------------------------------------------------

// Wrap a raw 64-byte ed25519 signature in the SSH signature blob ssh-agent
// produces: { string algo, string signature } — so the direct-key fallback path
// puts the exact same bytes on the wire as the agent path.
export function encodeSignatureBlob(rawSig: Uint8Array): Uint8Array {
	const w = new SshBlobWriter();
	w.string(SSH_ED25519);
	w.string(rawSig);
	return w.finish();
}

function parseSignatureBlob(blob: Uint8Array): Uint8Array | null {
	const r = new SshBlobReader(blob);
	const algo = r.string();
	const sig = r.string();
	if (algo === null || sig === null) return null;
	if (utf8(algo) !== SSH_ED25519 || sig.length !== ED25519_SIG_LEN) return null;
	return sig;
}

// --- the challenge --------------------------------------------------------------

// Domain-separate what the client signs so a signature can never be replayed
// from (or into) another protocol that signs raw bytes with the same key.
export const AUTH_CONTEXT = 'terminal-mmo-auth-v1';
export const NONCE_LEN = 32;

export function challengePayload(nonce: Uint8Array): Uint8Array {
	const ctx = new TextEncoder().encode(AUTH_CONTEXT);
	const out = new Uint8Array(ctx.length + nonce.length);
	out.set(ctx, 0);
	out.set(nonce, ctx.length);
	return out;
}

// The pure verifier (the issue's seam): does `signatureBlob` prove control of
// `publicKeyLine`'s private key over this nonce? False — never a throw — for a
// bad key, tampered payload, or garbage blob.
export function verifyChallenge(
	publicKeyLine: string,
	nonce: Uint8Array,
	signatureBlob: Uint8Array,
): boolean {
	const pub = parsePublicKeyLine(publicKeyLine);
	if (!pub) return false;
	const sig = parseSignatureBlob(signatureBlob);
	if (!sig) return false;
	try {
		const der = new Uint8Array(ED25519_SPKI_PREFIX.length + pub.key.length);
		der.set(ED25519_SPKI_PREFIX, 0);
		der.set(pub.key, ED25519_SPKI_PREFIX.length);
		const keyObject = createPublicKey({
			key: Buffer.from(der),
			format: 'der',
			type: 'spki',
		});
		return verify(null, challengePayload(nonce), keyObject, sig);
	} catch {
		return false;
	}
}

// --- Handle claim registry ---------------------------------------------------------

// The durable account store (revises ADR 0006's ephemeral handle): one public
// key owns one Handle, and Handles are unique case-insensitively. Pure data
// + pure transitions; the server holds the live copy in memory and #236 makes it
// persistent (bun:sqlite) behind these same functions.
export interface AccountRegistry {
	// canonical public key -> the Handle's canonical casing
	handleByKey: Record<string, string>;
	// lowercased Handle -> the canonical public key that owns it
	keyByHandle: Record<string, string>;
}

export function createAccountRegistry(): AccountRegistry {
	return { handleByKey: {}, keyByHandle: {} };
}

// 2–16 chars of [A-Za-z0-9_-]: fits the nameplate, unambiguous in `/w <handle>`,
// and never needs escaping in chat attribution.
export const HANDLE_RE = /^[A-Za-z0-9_-]{2,16}$/;
export function validHandle(handle: string): boolean {
	return HANDLE_RE.test(handle);
}

export function handleForKey(
	reg: AccountRegistry,
	publicKeyLine: string,
): string | undefined {
	const pub = parsePublicKeyLine(publicKeyLine);
	if (!pub) return undefined;
	return reg.handleByKey[canonicalPublicKey(pub)];
}

export type ClaimResult =
	| { ok: true; registry: AccountRegistry; handle: string }
	| { ok: false; reason: 'invalid' | 'taken' };

// First launch claims: bind `handle` to the key. A key that already owns a
// Handle keeps it (identity is durable — the desired one is ignored), and a
// Handle owned by a *different* key is refused, case-insensitively.
export function claimHandle(
	reg: AccountRegistry,
	publicKeyLine: string,
	handle: string,
): ClaimResult {
	const pub = parsePublicKeyLine(publicKeyLine);
	if (!pub) return { ok: false, reason: 'invalid' };
	const key = canonicalPublicKey(pub);
	const existing = reg.handleByKey[key];
	if (existing !== undefined)
		return { ok: true, registry: reg, handle: existing };
	if (!validHandle(handle)) return { ok: false, reason: 'invalid' };
	const lower = handle.toLowerCase();
	if (reg.keyByHandle[lower] !== undefined)
		return { ok: false, reason: 'taken' };
	return {
		ok: true,
		registry: {
			handleByKey: { ...reg.handleByKey, [key]: handle },
			keyByHandle: { ...reg.keyByHandle, [lower]: key },
		},
		handle,
	};
}

// --- resolveAuth: the whole handshake decision, sockets excluded -------------------

export type AuthResult =
	| { ok: true; registry: AccountRegistry; handle: string }
	| { ok: false; reason: string };

/**
 * The server-side auth decision for one connection, as one pure function:
 * verify the challenge signature, then resolve the key to its durable Handle
 * — an already-registered key gets its registered Handle (whatever it asked
 * for); an unknown key claims `desiredHandle`. `reason` strings are
 * player-facing — the client prints them verbatim on reject.
 */
export function resolveAuth(
	reg: AccountRegistry,
	publicKeyLine: string,
	nonce: Uint8Array,
	signatureBlob: Uint8Array,
	desiredHandle: string,
): AuthResult {
	if (!parsePublicKeyLine(publicKeyLine))
		return {
			ok: false,
			reason:
				'Unsupported or malformed SSH public key — an ed25519 key is required (ssh-keygen -t ed25519).',
		};
	if (!verifyChallenge(publicKeyLine, nonce, signatureBlob))
		return {
			ok: false,
			reason:
				'SSH signature verification failed — the key that signed does not match the public key offered.',
		};
	const claim = claimHandle(reg, publicKeyLine, desiredHandle.trim());
	if (claim.ok)
		return { ok: true, registry: claim.registry, handle: claim.handle };
	if (claim.reason === 'taken')
		return {
			ok: false,
			reason: `The handle "${desiredHandle.trim()}" is already claimed by another key — relaunch with MMO_HANDLE=<other-name> to pick a different one.`,
		};
	return {
		ok: false,
		reason: `"${desiredHandle.trim()}" is not a valid handle — use 2–16 letters, digits, - or _ (relaunch with MMO_HANDLE=<name>).`,
	};
}
