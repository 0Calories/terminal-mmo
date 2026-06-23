// The SoundSystem facade (ADR 0014): the single choke point that owns OpenTUI's
// native Audio engine and an `enabled` flag. Best-effort and always optional —
// init is attempted once, gated on an interactive TTY, and any failure flips
// `enabled = false` so every play() becomes a silent no-op. The game behaves
// byte-identically with audio off; @mmo/shared never references this module, so
// headless zone-judging, piped/CI runs, and any non-interactive launch stay
// silent and unaffected.

import { Audio, type AudioGroup, type AudioSound } from '@opentui/core';
import {
	BUS_BY_KIND,
	BUSES,
	type Bus,
	SOUND_SPECS,
	type SoundKind,
} from './registry';
import { renderWav } from './synth';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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
	// The mixing control plane (ADR 0014, #149). State is in-memory for this slice —
	// persistence + the options UI land in #150. It is kept whether or not the engine
	// is live so callers (the `m` key, the future modal) read a consistent picture;
	// the actual engine calls are guarded and silently no-op when disabled.
	private readonly groups = new Map<Bus, AudioGroup>();
	private readonly busVolumes = new Map<Bus, number>(BUSES.map((b) => [b, 1]));
	private master = 1;
	private isMuted = false;
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
			this.makeGroups();
			this.loadAll();
			this.enabled = true;
		} catch (err) {
			this.warn(`audio init threw: ${(err as Error).message}`);
			this.enabled = false;
		}
	}

	// Create one named voice group per bus (ADR 0014). A group that fails to create
	// is simply absent — voices for it then play directly on the master, never
	// crashing. `ambient` is created too, even though no voice routes to it yet, so
	// its slot exists for ambient/music without a later structural change.
	private makeGroups(): void {
		if (!this.engine) return;
		for (const bus of BUSES) {
			const group = this.engine.group(bus);
			if (group != null) this.groups.set(bus, group);
			else this.warn(`failed to create audio group: ${bus}`);
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
		// Route the voice into its bus group so per-bus volume/mute applies. A missing
		// group (creation failed) plays on the master — degraded, not silent.
		const group = this.groups.get(BUS_BY_KIND[kind]);
		try {
			this.engine.play(sound, {
				volume: opts.volume ?? 1,
				pan: opts.pan ?? 0,
				...(group != null ? { groupId: group } : {}),
			});
		} catch (err) {
			this.warn(`play(${kind}) failed: ${(err as Error).message}`);
		}
	}

	// --- Mixing control plane (ADR 0014, #149) ---------------------------------
	// Live, in-memory mixer state. Each setter updates the bookkeeping (so it holds
	// even with audio disabled) and best-effort pushes it to the engine. Mute is a
	// master override: while muted the engine master sits at 0 regardless of the
	// stored master volume, which is restored on unmute.

	get muted(): boolean {
		return this.isMuted;
	}

	get masterVolume(): number {
		return this.master;
	}

	busVolume(bus: Bus): number {
		return this.busVolumes.get(bus) ?? 1;
	}

	setMasterVolume(volume: number): void {
		this.master = clamp01(volume);
		if (!this.isMuted) this.engine?.setMasterVolume(this.master);
	}

	setBusVolume(bus: Bus, volume: number): void {
		const v = clamp01(volume);
		this.busVolumes.set(bus, v);
		const group = this.groups.get(bus);
		if (group != null) this.engine?.setGroupVolume(group, v);
	}

	setMuted(muted: boolean): void {
		this.isMuted = muted;
		// Mute silences the master instantly; unmute restores the stored master volume.
		this.engine?.setMasterVolume(muted ? 0 : this.master);
	}

	// Flip master mute and report the new state. Bound to `m` for an instant toggle.
	toggleMute(): boolean {
		this.setMuted(!this.isMuted);
		return this.isMuted;
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
