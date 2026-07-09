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
	isTTY?: boolean;
	debug?: boolean;
}

export class SoundSystem {
	enabled = false;
	private engine: Audio | null = null;
	private readonly sounds = new Map<SoundKind, AudioSound>();
	private readonly groups = new Map<Bus, AudioGroup>();
	private readonly busVolumes = new Map<Bus, number>(BUSES.map((b) => [b, 1]));
	private master = 1;
	private isMuted = false;
	private readonly debug: boolean;
	private warned = false;
	private static readonly ERROR_LIMIT = 8;
	private engineErrors = 0;
	onChange?: () => void;
	onDegraded?: () => void;

	constructor(opts: SoundSystemOptions = {}) {
		this.debug = opts.debug ?? false;
		const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
		if (!isTTY) return;

		try {
			const engine = Audio.create();
			if (!engine) {
				this.warn('Audio.create() returned null');
				return;
			}
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

	private makeGroups(): void {
		if (!this.engine) return;
		for (const bus of BUSES) {
			const group = this.engine.group(bus);
			if (group != null) this.groups.set(bus, group);
			else this.warn(`failed to create audio group: ${bus}`);
		}
	}

	private loadAll(): void {
		if (!this.engine) return;
		for (const kind of Object.keys(SOUND_SPECS) as SoundKind[]) {
			const handle = this.engine.loadSound(renderWav(SOUND_SPECS[kind]));
			if (handle != null) this.sounds.set(kind, handle);
			else this.warn(`failed to load sound: ${kind}`);
		}
	}

	play(kind: SoundKind, opts: { volume?: number; pan?: number } = {}): void {
		if (!this.enabled || !this.engine) return;
		const sound = this.sounds.get(kind);
		if (sound == null) return;
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

	toggleMute(): boolean {
		this.setMuted(!this.isMuted);
		return this.isMuted;
	}

	// A load, not a user edit: must not fire onChange or it writes loaded prefs back to disk.
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

	dispose(): void {
		if (!this.engine) return;
		try {
			this.engine.dispose();
		} catch {}
		this.engine = null;
		this.enabled = false;
	}

	private handleEngineError(err: Error): void {
		this.engineErrors++;
		this.warn(`audio engine error: ${err.message}`);
		if (this.engineErrors > SoundSystem.ERROR_LIMIT && this.enabled) {
			this.enabled = false;
			this.onDegraded?.();
		}
	}

	private warn(message: string): void {
		if (this.warned) return;
		this.warned = true;
		if (this.debug) console.error(`[sound] ${message}`);
	}
}
