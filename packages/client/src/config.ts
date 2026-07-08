// The client's config file (ADR 0015): XDG-aware (`~/.config/terminal-mmo/config.json`,
// honoring XDG_CONFIG_HOME), keyed by area. Tolerant by construction: a missing/corrupt
// file falls back to defaults, a failed write degrades to in-memory for the session, and
// unknown keys survive a rewrite so a newer client's settings outlive an older one.
// Client-only; never sent over the wire.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// The per-machine anchor pinning which Identity Key won last, so a returning Player
// resolves to the same account (#297). It is the Save-safety guard: discovery mints a
// new key only when there is NO anchor, so an anchored machine can't silently flip keys
// and orphan its Save.
export interface IdentityAnchor {
	publicKey: string; // OpenSSH one-line form of the anchored Identity Key
	source: 'external' | 'generated';
}

// `muted` is master mute; `buses` holds per-bus volumes (`ambient` has no voices yet,
// so it isn't persisted). Volumes are 0..1 (ADR 0014/0015).
export interface AudioPrefs {
	master: number;
	muted: boolean;
	buses: { combat: number; movement: number; ui: number };
}

// Sound on, full volume — the fallback when the file (or a key) is missing. Picked so
// a first-ever launch is audible.
export const AUDIO_DEFAULTS: AudioPrefs = {
	master: 1,
	muted: false,
	buses: { combat: 1, movement: 1, ui: 1 },
};

type Raw = Record<string, unknown>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// A finite number in 0..1, else the default — tolerates a string/null/NaN/Infinity
// in the file.
const vol = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback;

const isObject = (v: unknown): v is Raw =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

// From XDG_CONFIG_HOME (when set + non-blank), else `<home>/.config`.
export function resolveConfigPath(
	xdgConfigHome: string | undefined,
	home: string,
): string {
	const base = xdgConfigHome?.trim() ? xdgConfigHome : join(home, '.config');
	return join(base, 'terminal-mmo', 'config.json');
}

// Tolerates anything: invalid JSON or a non-object top-level (array/number/null) both
// yield `{}`.
export function parseConfig(text: string): Raw {
	try {
		const v: unknown = JSON.parse(text);
		return isObject(v) ? v : {};
	} catch {
		return {};
	}
}

// Default-fill and clamp every field so a partial / wrong-typed `audio` block still
// resolves to a valid AudioPrefs.
export function readAudioPrefs(raw: Raw): AudioPrefs {
	const a = isObject(raw.audio) ? raw.audio : {};
	const b = isObject(a.buses) ? a.buses : {};
	return {
		master: vol(a.master, AUDIO_DEFAULTS.master),
		muted: typeof a.muted === 'boolean' ? a.muted : AUDIO_DEFAULTS.muted,
		buses: {
			combat: vol(b.combat, AUDIO_DEFAULTS.buses.combat),
			movement: vol(b.movement, AUDIO_DEFAULTS.buses.movement),
			ui: vol(b.ui, AUDIO_DEFAULTS.buses.ui),
		},
	};
}

// Merge audio into raw, preserving unknown keys at top level and inside `audio`/
// `audio.buses` (spread first), so a newer client's setting survives an older client's
// rewrite.
export function writeAudioPrefs(raw: Raw, audio: AudioPrefs): Raw {
	const prevAudio = isObject(raw.audio) ? raw.audio : {};
	const prevBuses = isObject(prevAudio.buses) ? prevAudio.buses : {};
	return {
		...raw,
		audio: {
			...prevAudio,
			master: audio.master,
			muted: audio.muted,
			buses: { ...prevBuses, ...audio.buses },
		},
	};
}

// Strict: a missing anchor, a non-string/empty `publicKey`, or an unknown `source` all
// resolve to `null`. Deliberate — a malformed anchor must read as absent so discovery
// falls through to a fresh mint rather than refusing launch on garbage.
export function readIdentityAnchor(raw: Raw): IdentityAnchor | null {
	const identity = isObject(raw.identity) ? raw.identity : {};
	const a = isObject(identity.anchor) ? identity.anchor : null;
	if (!a) return null;
	const publicKey = a.publicKey;
	const source = a.source;
	if (typeof publicKey !== 'string' || publicKey.length === 0) return null;
	if (source !== 'external' && source !== 'generated') return null;
	return { publicKey, source };
}

// Merge the anchor into raw, preserving unknown keys like writeAudioPrefs.
export function writeIdentityAnchor(raw: Raw, anchor: IdentityAnchor): Raw {
	const prevIdentity = isObject(raw.identity) ? raw.identity : {};
	return {
		...raw,
		identity: {
			...prevIdentity,
			anchor: { publicKey: anchor.publicKey, source: anchor.source },
		},
	};
}

// The fs shell: holds the raw config in memory (preserving unknown keys), reads/writes
// at `path`. Tolerant — load never throws, saves are best-effort (a failed write keeps
// the merged state in memory for the session).
export class ConfigStore {
	readonly path: string;
	private raw: Raw = {};

	constructor(
		path: string = resolveConfigPath(process.env.XDG_CONFIG_HOME, homedir()),
	) {
		this.path = path;
	}

	// A missing or unreadable file leaves the in-memory config empty, so every getter
	// falls back to defaults.
	load(): this {
		try {
			this.raw = parseConfig(readFileSync(this.path, 'utf8'));
		} catch {
			this.raw = {};
		}
		return this;
	}

	// A sibling of config.json in the XDG dir (`.../terminal-mmo/id_ed25519`), NOT
	// `~/.ssh`, so it can't collide with the real `ssh`. Only generated players write it
	// (#297).
	get identityKeyPath(): string {
		return join(dirname(this.path), 'id_ed25519');
	}

	audio(): AudioPrefs {
		return readAudioPrefs(this.raw);
	}

	identityAnchor(): IdentityAnchor | null {
		return readIdentityAnchor(this.raw);
	}

	// Merge audio into memory and best-effort persist; on failure the merged config stays
	// in memory. Returns whether the write landed.
	saveAudio(audio: AudioPrefs): boolean {
		this.raw = writeAudioPrefs(this.raw, audio);
		return this.persist();
	}

	// Merge the anchor into memory and best-effort persist; same tolerance as saveAudio.
	saveIdentityAnchor(anchor: IdentityAnchor): boolean {
		this.raw = writeIdentityAnchor(this.raw, anchor);
		return this.persist();
	}

	// Serialize the in-memory config to disk (creating the dir), returning whether the
	// write landed.
	private persist(): boolean {
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, `${JSON.stringify(this.raw, null, 2)}\n`);
			return true;
		} catch {
			return false;
		}
	}
}
