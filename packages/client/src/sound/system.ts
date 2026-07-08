// The SoundSystem facade (ADR 0014): best-effort and always optional. Init is
// attempted once, gated on an interactive TTY; any failure flips `enabled = false`
// so every play() becomes a silent no-op. @mmo/shared never references this module,
// so headless/piped/CI runs stay silent and unaffected.

import { Audio, type AudioGroup, type AudioSound } from '@opentui/core';
import type { AudioPrefs } from '../config';
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
	// Emit the one-time init-failure line to stderr. Off by default so it never prints
	// into the TUI (opt in with MMO_DEBUG).
	debug?: boolean;
}

export class SoundSystem {
	enabled = false;
	private engine: Audio | null = null;
	private readonly sounds = new Map<SoundKind, AudioSound>();
	// Mixer state kept whether or not the engine is live, so callers read a consistent
	// picture; engine calls are guarded and no-op when disabled (ADR 0014, #149).
	private readonly groups = new Map<Bus, AudioGroup>();
	private readonly busVolumes = new Map<Bus, number>(BUSES.map((b) => [b, 1]));
	private master = 1;
	private isMuted = false;
	private readonly debug: boolean;
	private warned = false;
	// Running count of engine `error` events; audio degrades only past ERROR_LIMIT
	// (see handleEngineError, #268).
	private static readonly ERROR_LIMIT = 8;
	private engineErrors = 0;
	// Fired after a user-facing mixer change so the caller persists it (#150). NOT fired
	// by applyAudioPrefs (a load), which would round-trip freshly-loaded prefs to disk.
	onChange?: () => void;
	// Fired once when sustained engine errors force audio off (#268), so the caller can
	// surface a visible warning — a permanent audio loss should announce itself.
	onDegraded?: () => void;

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
			// Tolerated best-effort, not thrown into the render loop: degrade only after
			// a sustained burst (see handleEngineError).
			engine.on('error', (err) => this.handleEngineError(err));
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

	// One voice group per bus (ADR 0014). A group that fails to create is absent — its
	// voices then play on the master, never crashing. `ambient` is created too, though
	// no voice routes to it yet, so its slot exists for later.
	private makeGroups(): void {
		if (!this.engine) return;
		for (const bus of BUSES) {
			const group = this.engine.group(bus);
			if (group != null) this.groups.set(bus, group);
			else this.warn(`failed to create audio group: ${bus}`);
		}
	}

	// Render each spec to a WAV and load it, caching the handle by kind. A sound that
	// fails to load is absent — playing it is a no-op, not a crash.
	private loadAll(): void {
		if (!this.engine) return;
		for (const kind of Object.keys(SOUND_SPECS) as SoundKind[]) {
			const handle = this.engine.loadSound(renderWav(SOUND_SPECS[kind]));
			if (handle != null) this.sounds.set(kind, handle);
			else this.warn(`failed to load sound: ${kind}`);
		}
	}

	// A no-op when disabled or the kind never loaded, and never throws — the only place
	// that touches the engine, so call sites stay try/catch-free.
	play(kind: SoundKind, opts: { volume?: number; pan?: number } = {}): void {
		if (!this.enabled || !this.engine) return;
		const sound = this.sounds.get(kind);
		if (sound == null) return;
		// Route into the bus group so per-bus volume/mute applies. A missing group plays
		// on the master — degraded, not silent.
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
	// Each setter updates in-memory bookkeeping (holds even with audio disabled) and
	// best-effort pushes to the engine. Mute is a master override: while muted the engine
	// master sits at 0 regardless of the stored master, restored on unmute.

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
		this.onChange?.();
	}

	setBusVolume(bus: Bus, volume: number): void {
		const v = clamp01(volume);
		this.busVolumes.set(bus, v);
		const group = this.groups.get(bus);
		if (group != null) this.engine?.setGroupVolume(group, v);
		this.onChange?.();
	}

	setMuted(muted: boolean): void {
		this.isMuted = muted;
		this.engine?.setMasterVolume(muted ? 0 : this.master);
		this.onChange?.();
	}

	// Flip mute and report the new state; bound to `m`.
	toggleMute(): boolean {
		this.setMuted(!this.isMuted);
		return this.isMuted;
	}

	// --- Persistence seam (#150, ADR 0015) -------------------------------------

	// A LOAD, not a user edit, so it pushes to the engine WITHOUT firing onChange (which
	// would write the just-loaded prefs straight back to disk). Clamped defensively so a
	// hand-edited/older config can't drive the mixer out of range; only the three voiced
	// buses persist.
	applyAudioPrefs(prefs: AudioPrefs): void {
		this.master = clamp01(prefs.master);
		this.isMuted = prefs.muted;
		this.busVolumes.set('combat', clamp01(prefs.buses.combat));
		this.busVolumes.set('movement', clamp01(prefs.buses.movement));
		this.busVolumes.set('ui', clamp01(prefs.buses.ui));
		for (const [bus, group] of this.groups)
			this.engine?.setGroupVolume(group, this.busVolumes.get(bus) ?? 1);
		this.engine?.setMasterVolume(this.isMuted ? 0 : this.master);
	}

	// The current mixer state in the persisted shape.
	audioPrefs(): AudioPrefs {
		return {
			master: this.master,
			muted: this.isMuted,
			buses: {
				combat: this.busVolume('combat'),
				movement: this.busVolume('movement'),
				ui: this.busVolume('ui'),
			},
		};
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

	// Transient errors (a per-voice glitch, voice-pool exhaustion on a room switch) must
	// not permanently disable audio, so we count and stay enabled through a burst. Only
	// past ERROR_LIMIT do we degrade for the session, firing onDegraded once on the
	// enabled→disabled edge (#268).
	private handleEngineError(err: Error): void {
		this.engineErrors++;
		this.warn(`audio engine error: ${err.message}`);
		if (this.engineErrors > SoundSystem.ERROR_LIMIT && this.enabled) {
			this.enabled = false;
			this.onDegraded?.();
		}
	}

	// Log the first failure only, and only when debugging — a disabled SoundSystem
	// is a normal, silent state, not an error to spam.
	private warn(message: string): void {
		if (this.warned) return;
		this.warned = true;
		if (this.debug) console.error(`[sound] ${message}`);
	}
}
