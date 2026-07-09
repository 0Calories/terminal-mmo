import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	AUDIO_DEFAULTS,
	ConfigStore,
	parseConfig,
	readAudioPrefs,
	readIdentityAnchor,
	resolveConfigPath,
	writeAudioPrefs,
	writeIdentityAnchor,
} from '../src/config';

const tmpDirs: string[] = [];
function tmp(): string {
	const dir = mkdtempSync(join(tmpdir(), 'mmo-config-'));
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of tmpDirs.splice(0))
		rmSync(d, { recursive: true, force: true });
});

test('XDG_CONFIG_HOME override wins over the home fallback', () => {
	expect(resolveConfigPath('/xdg', '/home/p')).toBe(
		'/xdg/terminal-mmo/config.json',
	);
});

test('a missing/blank XDG var falls back to <home>/.config', () => {
	expect(resolveConfigPath(undefined, '/home/p')).toBe(
		'/home/p/.config/terminal-mmo/config.json',
	);
	expect(resolveConfigPath('   ', '/home/p')).toBe(
		'/home/p/.config/terminal-mmo/config.json',
	);
});

test('corrupt / non-object JSON parses to an empty config, not a throw', () => {
	expect(parseConfig('not json{{{')).toEqual({});
	expect(parseConfig('[1,2,3]')).toEqual({});
	expect(parseConfig('42')).toEqual({});
	expect(parseConfig('null')).toEqual({});
});

test('an empty config reads as the built-in defaults (sound on, full volume)', () => {
	expect(readAudioPrefs({})).toEqual(AUDIO_DEFAULTS);
});

test('a partial audio block keeps its values and defaults the rest', () => {
	const prefs = readAudioPrefs({
		audio: { muted: true, buses: { combat: 0.5 } },
	});
	expect(prefs.muted).toBe(true);
	expect(prefs.buses.combat).toBe(0.5);
	expect(prefs.buses.movement).toBe(1);
	expect(prefs.master).toBe(1);
});

test('out-of-range / wrong-typed volumes are clamped or defaulted', () => {
	const prefs = readAudioPrefs({
		audio: { master: 5, muted: 'yes', buses: { combat: -2, ui: 'loud' } },
	});
	expect(prefs.master).toBe(1);
	expect(prefs.buses.combat).toBe(0);
	expect(prefs.buses.ui).toBe(1);
	expect(prefs.muted).toBe(false);
});

test('writeAudioPrefs preserves unknown top-level and nested keys', () => {
	const raw = {
		keybinds: { jump: 'space' },
		audio: { theme: 'retro', buses: { ambient: 0.7 } },
	};
	const next = writeAudioPrefs(raw, {
		master: 0.4,
		muted: true,
		buses: { combat: 0.5, movement: 0.6, ui: 0.7 },
	});
	expect(next.keybinds).toEqual({ jump: 'space' });
	const audio = next.audio as Record<string, unknown>;
	expect(audio.theme).toBe('retro');
	expect(audio.master).toBe(0.4);
	expect((audio.buses as Record<string, number>).ambient).toBe(0.7);
	expect((audio.buses as Record<string, number>).combat).toBe(0.5);
});

test('a missing file loads as defaults without throwing', () => {
	const store = new ConfigStore(join(tmp(), 'nope', 'config.json')).load();
	expect(store.audio()).toEqual(AUDIO_DEFAULTS);
});

test('saving then reloading restores the saved audio state', () => {
	const path = join(tmp(), 'config.json');
	const saved = {
		master: 0.3,
		muted: true,
		buses: { combat: 0.2, movement: 0.9, ui: 0.5 },
	};
	expect(new ConfigStore(path).saveAudio(saved)).toBe(true);
	expect(new ConfigStore(path).load().audio()).toEqual(saved);
});

test('a rewrite preserves unknown keys already on disk', () => {
	const path = join(tmp(), 'config.json');
	writeFileSync(path, JSON.stringify({ handle: 'ash', audio: { theme: 'x' } }));
	const store = new ConfigStore(path).load();
	store.saveAudio({ ...AUDIO_DEFAULTS, muted: true });
	const reloaded = new ConfigStore(path).load();
	expect(reloaded.audio().muted).toBe(true);
	const onDisk = new ConfigStore(path).load();
	expect(onDisk.audio()).toEqual({ ...AUDIO_DEFAULTS, muted: true });
});

test('a failed write degrades to in-memory and returns false, never throws', () => {
	// parent path is a FILE, so mkdir/write fails
	const filePath = join(tmp(), 'afile');
	writeFileSync(filePath, 'x');
	const store = new ConfigStore(join(filePath, 'config.json'));
	expect(store.saveAudio({ ...AUDIO_DEFAULTS, master: 0.5 })).toBe(false);
	expect(store.audio().master).toBe(0.5);
});

test('readIdentityAnchor returns null for a missing or malformed anchor', () => {
	expect(readIdentityAnchor({})).toBeNull();
	expect(readIdentityAnchor({ identity: {} })).toBeNull();
	expect(
		readIdentityAnchor({
			identity: { anchor: { publicKey: 'k', source: 'nope' } },
		}),
	).toBeNull();
	expect(
		readIdentityAnchor({
			identity: { anchor: { publicKey: '', source: 'generated' } },
		}),
	).toBeNull();
	expect(
		readIdentityAnchor({
			identity: { anchor: { publicKey: 42, source: 'external' } },
		}),
	).toBeNull();
});

test('readIdentityAnchor accepts a well-formed external / generated anchor', () => {
	expect(
		readIdentityAnchor({
			identity: {
				anchor: { publicKey: 'ssh-ed25519 AAAA', source: 'external' },
			},
		}),
	).toEqual({ publicKey: 'ssh-ed25519 AAAA', source: 'external' });
	expect(
		readIdentityAnchor({
			identity: {
				anchor: { publicKey: 'ssh-ed25519 BBBB', source: 'generated' },
			},
		}),
	).toEqual({ publicKey: 'ssh-ed25519 BBBB', source: 'generated' });
});

test('writeIdentityAnchor preserves unknown top-level and nested keys', () => {
	const raw = {
		audio: { muted: true },
		identity: { migratedAt: 123 },
	};
	const next = writeIdentityAnchor(raw, {
		publicKey: 'ssh-ed25519 K',
		source: 'generated',
	});
	expect((next.audio as Record<string, unknown>).muted).toBe(true);
	const identity = next.identity as Record<string, unknown>;
	expect(identity.migratedAt).toBe(123);
	expect(identity.anchor).toEqual({
		publicKey: 'ssh-ed25519 K',
		source: 'generated',
	});
});

test('identityKeyPath is a sibling of config.json in the config dir', () => {
	const store = new ConfigStore('/xdg/terminal-mmo/config.json');
	expect(store.identityKeyPath).toBe('/xdg/terminal-mmo/id_ed25519');
});

test('saveIdentityAnchor round-trips and preserves the audio area', () => {
	const path = join(tmp(), 'config.json');
	const first = new ConfigStore(path);
	expect(first.saveAudio({ ...AUDIO_DEFAULTS, muted: true })).toBe(true);
	expect(
		first.saveIdentityAnchor({
			publicKey: 'ssh-ed25519 X',
			source: 'external',
		}),
	).toBe(true);
	const reloaded = new ConfigStore(path).load();
	expect(reloaded.identityAnchor()).toEqual({
		publicKey: 'ssh-ed25519 X',
		source: 'external',
	});
	expect(reloaded.audio().muted).toBe(true);
});
