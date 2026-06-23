// The client's first footprint on the player's disk (ADR 0015): one general,
// human-readable, XDG-aware config file (`~/.config/terminal-mmo/config.json`,
// honoring XDG_CONFIG_HOME). It is a settings store keyed by area — audio is its
// first tenant, not its schema — and tolerant by construction: a missing/partial/
// corrupt file falls back to built-in defaults, a failed write degrades to
// in-memory-only for the session, and unknown keys survive a rewrite so a newer
// client's settings outlive an older one. Client-only; never sent over the wire.
//
// The path resolution and the parse/merge/clamp are the PURE, testable seam; the
// `ConfigStore` shell is the thin fs wrapper around them (round-trip-tested via a
// temp path).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// The audio area's persisted shape (ADR 0014/0015). `muted` is the master mute;
// `buses` holds the per-bus volumes the mixer exposes (combat / movement / ui —
// `ambient` has no voices yet, so it isn't persisted). Volumes are 0..1.
export interface AudioPrefs {
	master: number;
	muted: boolean;
	buses: { combat: number; movement: number; ui: number };
}

// Sound on, everything at full volume — the fallback whenever the file (or a key)
// is missing or unreadable. Picked so a first-ever launch is audible.
export const AUDIO_DEFAULTS: AudioPrefs = {
	master: 1,
	muted: false,
	buses: { combat: 1, movement: 1, ui: 1 },
};

type Raw = Record<string, unknown>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// A finite number in 0..1, else the default — tolerates a string/null/NaN/Infinity
// in the file without erroring.
const vol = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback;

const isObject = (v: unknown): v is Raw =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

// Resolve the config path from the XDG_CONFIG_HOME override (when set + non-blank)
// or `<home>/.config`. Pure given its inputs so it's testable without touching env.
export function resolveConfigPath(
	xdgConfigHome: string | undefined,
	home: string,
): string {
	const base = xdgConfigHome?.trim() ? xdgConfigHome : join(home, '.config');
	return join(base, 'terminal-mmo', 'config.json');
}

// Parse the file's text into a raw object, tolerating anything: invalid JSON, or a
// top-level non-object (array / number / null), both yield `{}`. Never throws.
export function parseConfig(text: string): Raw {
	try {
		const v: unknown = JSON.parse(text);
		return isObject(v) ? v : {};
	} catch {
		return {};
	}
}

// Extract the audio prefs from a raw config, default-filling and clamping every
// field so a partial / wrong-typed `audio` block resolves to a valid AudioPrefs.
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

// Merge audio prefs into a raw config, returning a new object. Unknown top-level
// keys AND unknown keys inside `audio` / `audio.buses` are preserved (spread first,
// then overwritten), so a setting a newer client wrote survives an older client's
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

// The fs shell: holds the raw config in memory (preserving unknown keys) and reads/
// writes it at `path`. Every operation is tolerant — load never throws (missing /
// unreadable / corrupt → defaults), and saveAudio is best-effort (a failed write
// keeps the merged state in memory for the session and returns false, never throws).
export class ConfigStore {
	readonly path: string;
	private raw: Raw = {};

	constructor(
		path: string = resolveConfigPath(process.env.XDG_CONFIG_HOME, homedir()),
	) {
		this.path = path;
	}

	// Read + parse the file into memory. A missing or unreadable file leaves the
	// in-memory config empty, so every getter falls back to defaults.
	load(): this {
		try {
			this.raw = parseConfig(readFileSync(this.path, 'utf8'));
		} catch {
			this.raw = {};
		}
		return this;
	}

	audio(): AudioPrefs {
		return readAudioPrefs(this.raw);
	}

	// Merge audio prefs into the in-memory config and best-effort persist to disk.
	// Returns whether the write landed; on failure the merged config still lives in
	// memory for the rest of the session.
	saveAudio(audio: AudioPrefs): boolean {
		this.raw = writeAudioPrefs(this.raw, audio);
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, `${JSON.stringify(this.raw, null, 2)}\n`);
			return true;
		} catch {
			return false;
		}
	}
}
