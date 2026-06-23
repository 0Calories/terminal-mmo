// The SoundSystem facade (ADR 0014): the single choke point that owns OpenTUI's
// native Audio engine and an `enabled` flag. Best-effort and always optional —
// init is attempted once, gated on an interactive TTY, and any failure flips
// `enabled = false` so every play() becomes a silent no-op. The game behaves
// byte-identically with audio off; @mmo/shared never references this module, so
// headless zone-judging, piped/CI runs, and any non-interactive launch stay
// silent and unaffected.

import { Audio, type AudioSound } from '@opentui/core';
import { SOUND_SPECS, type SoundKind } from './registry';
import { renderWav } from './synth';

export interface SoundSystemOptions {
	// Whether stdout is an interactive terminal. Injected for tests; defaults to
	// the real `process.stdout.isTTY`.
	isTTY?: boolean;
	// Emit the one-time init-failure line to stderr. Off by default so a failed
	// init never prints into the TUI; opt in with MMO_DEBUG for diagnosis.
	debug?: boolean;
}

export class SoundSystem {
	enabled = false;
	private engine: Audio | null = null;
	private readonly sounds = new Map<SoundKind, AudioSound>();
	private readonly debug: boolean;
	private warned = false;

	constructor(opts: SoundSystemOptions = {}) {
		this.debug = opts.debug ?? false;
		const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
		// Headless / piped / CI: never even touch the native audio engine.
		if (!isTTY) return;

		try {
			const engine = Audio.create();
			if (!engine) {
				this.warn('Audio.create() returned null');
				return;
			}
			// A serious engine-level error degrades to silence rather than throwing
			// into the render loop; per-voice glitches are tolerated best-effort.
			engine.on('error', (err) => {
				this.enabled = false;
				this.warn(`audio engine error: ${err.message}`);
			});
			if (!engine.start()) {
				this.warn('audio engine start() returned false');
				engine.dispose();
				return;
			}
			this.engine = engine;
			this.loadAll();
			this.enabled = true;
		} catch (err) {
			this.warn(`audio init threw: ${(err as Error).message}`);
			this.enabled = false;
		}
	}

	// Render every registered spec to a WAV and load it into the engine, caching
	// the returned handle by kind. A sound that fails to load is simply absent —
	// playing it later is a no-op, not a crash.
	private loadAll(): void {
		if (!this.engine) return;
		for (const kind of Object.keys(SOUND_SPECS) as SoundKind[]) {
			const handle = this.engine.loadSound(renderWav(SOUND_SPECS[kind]));
			if (handle != null) this.sounds.set(kind, handle);
			else this.warn(`failed to load sound: ${kind}`);
		}
	}

	// Play a sound. A no-op when audio is disabled or the kind never loaded, and
	// it never throws — the facade is the only place that touches the engine, so
	// call sites stay try/catch-free.
	play(kind: SoundKind, opts: { volume?: number; pan?: number } = {}): void {
		if (!this.enabled || !this.engine) return;
		const sound = this.sounds.get(kind);
		if (sound == null) return;
		try {
			this.engine.play(sound, {
				volume: opts.volume ?? 1,
				pan: opts.pan ?? 0,
			});
		} catch (err) {
			this.warn(`play(${kind}) failed: ${(err as Error).message}`);
		}
	}

	// Tear down the engine on clean shutdown, never blocking exit.
	dispose(): void {
		if (!this.engine) return;
		try {
			this.engine.dispose();
		} catch {}
		this.engine = null;
		this.enabled = false;
	}

	// Log the first failure only, and only when debugging — a disabled SoundSystem
	// is a normal, silent state, not an error to spam.
	private warn(message: string): void {
		if (this.warned) return;
		this.warned = true;
		if (this.debug) console.error(`[sound] ${message}`);
	}
}
