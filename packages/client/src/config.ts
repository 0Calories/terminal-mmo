import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface IdentityAnchor {
	publicKey: string;
	source: 'external' | 'generated';
}

export interface AudioPrefs {
	master: number;
	muted: boolean;
	buses: { combat: number; movement: number; ui: number };
}

export const AUDIO_DEFAULTS: AudioPrefs = {
	master: 1,
	muted: false,
	buses: { combat: 1, movement: 1, ui: 1 },
};

type Raw = Record<string, unknown>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const vol = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback;

const isObject = (v: unknown): v is Raw =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function resolveConfigPath(
	xdgConfigHome: string | undefined,
	home: string,
): string {
	const base = xdgConfigHome?.trim() ? xdgConfigHome : join(home, '.config');
	return join(base, 'terminal-mmo', 'config.json');
}

export function parseConfig(text: string): Raw {
	try {
		const v: unknown = JSON.parse(text);
		return isObject(v) ? v : {};
	} catch {
		return {};
	}
}

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

// A malformed anchor must resolve to null so discovery mints fresh rather than refusing launch.
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

export class ConfigStore {
	readonly path: string;
	private raw: Raw = {};

	constructor(
		path: string = resolveConfigPath(process.env.XDG_CONFIG_HOME, homedir()),
	) {
		this.path = path;
	}

	load(): this {
		try {
			this.raw = parseConfig(readFileSync(this.path, 'utf8'));
		} catch {
			this.raw = {};
		}
		return this;
	}

	// Sibling of config.json, not ~/.ssh, so it can't collide with real ssh keys.
	get identityKeyPath(): string {
		return join(dirname(this.path), 'id_ed25519');
	}

	audio(): AudioPrefs {
		return readAudioPrefs(this.raw);
	}

	identityAnchor(): IdentityAnchor | null {
		return readIdentityAnchor(this.raw);
	}

	saveAudio(audio: AudioPrefs): boolean {
		this.raw = writeAudioPrefs(this.raw, audio);
		return this.persist();
	}

	saveIdentityAnchor(anchor: IdentityAnchor): boolean {
		this.raw = writeIdentityAnchor(this.raw, anchor);
		return this.persist();
	}

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
