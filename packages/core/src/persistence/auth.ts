import { createPublicKey, verify } from 'node:crypto';

export const SSH_ED25519 = 'ssh-ed25519';
const ED25519_KEY_LEN = 32;
const ED25519_SIG_LEN = 64;

const ED25519_SPKI_PREFIX = Uint8Array.from(
	Buffer.from('302a300506032b6570032100', 'hex'),
);

export interface SshPublicKey {
	algo: typeof SSH_ED25519;
	key: Uint8Array;
	comment?: string;
}

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

export function parsePublicKeyBlob(blob: Uint8Array): SshPublicKey | null {
	const r = new SshBlobReader(blob);
	const algo = r.string();
	const key = r.string();
	if (algo === null || key === null) return null;
	if (utf8(algo) !== SSH_ED25519 || key.length !== ED25519_KEY_LEN) return null;
	return { algo: SSH_ED25519, key };
}

export function parsePublicKeyLine(line: string): SshPublicKey | null {
	const parts = line.trim().split(/\s+/);
	if (parts.length < 2 || parts[0] !== SSH_ED25519) return null;
	let blob: Buffer;
	try {
		blob = Buffer.from(parts[1], 'base64');
	} catch {
		return null;
	}

	if (
		blob.toString('base64').replace(/=+$/, '') !== parts[1].replace(/=+$/, '')
	)
		return null;
	const parsed = parsePublicKeyBlob(new Uint8Array(blob));
	if (!parsed) return null;
	const comment = parts.slice(2).join(' ');
	return comment ? { ...parsed, comment } : parsed;
}

export function canonicalPublicKey(k: SshPublicKey): string {
	const w = new SshBlobWriter();
	w.string(SSH_ED25519);
	w.string(k.key);
	return `${SSH_ED25519} ${Buffer.from(w.finish()).toString('base64')}`;
}

export function encodePublicKeyLine(raw: Uint8Array, comment?: string): string {
	const line = canonicalPublicKey({ algo: SSH_ED25519, key: raw });
	return comment ? `${line} ${comment}` : line;
}

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

export const AUTH_CONTEXT = 'terminal-mmo-auth-v1';
export const NONCE_LEN = 32;

export function challengePayload(nonce: Uint8Array): Uint8Array {
	const ctx = new TextEncoder().encode(AUTH_CONTEXT);
	const out = new Uint8Array(ctx.length + nonce.length);
	out.set(ctx, 0);
	out.set(nonce, ctx.length);
	return out;
}

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

export interface AccountRegistry {
	handleByKey: Record<string, string>;
	keyByHandle: Record<string, string>;
}

export function createAccountRegistry(): AccountRegistry {
	return { handleByKey: {}, keyByHandle: {} };
}

export const HANDLE_MIN_LEN = 2;
export const HANDLE_MAX_LEN = 16;
const HANDLE_CHAR_CLASS = 'A-Za-z0-9_-';
export const HANDLE_CHAR_RE = new RegExp(`^[${HANDLE_CHAR_CLASS}]$`);
export const HANDLE_RE = new RegExp(
	`^[${HANDLE_CHAR_CLASS}]{${HANDLE_MIN_LEN},${HANDLE_MAX_LEN}}$`,
);
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

export type AuthResult =
	| { ok: true; registry: AccountRegistry; handle: string }
	| { ok: false; reason: string };

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
	const existing = handleForKey(reg, publicKeyLine);
	return { ok: true, registry: reg, handle: existing ?? desiredHandle.trim() };
}
