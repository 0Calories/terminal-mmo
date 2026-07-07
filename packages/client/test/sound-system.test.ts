import { expect, test } from 'bun:test';
import { SoundSystem } from '../src/sound/system';

// The whole point of the facade: with no interactive TTY it never touches the
// native audio engine, stays disabled, and every play() is a silent no-op — the
// guarantee that keeps headless zone-judging and CI runs silent and unaffected.
test('without a TTY the system stays disabled and never touches audio', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(sound.enabled).toBe(false);
});

test('play() and dispose() are safe no-ops when disabled', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(() => sound.play('jump')).not.toThrow();
	expect(() => sound.play('jump', { volume: 0.5, pan: -1 })).not.toThrow();
	expect(() => sound.dispose()).not.toThrow();
	expect(sound.enabled).toBe(false);
});

// Mixing control plane (ADR 0014, #149). The state is plain in-memory bookkeeping
// that holds whether or not the engine is live, so the options modal (#150) and
// the `m` key read a consistent picture; the engine calls are guarded and no-op
// when disabled. Default state ships unmuted (the feature should announce itself).
test('master mute defaults off and toggles instantly', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(sound.muted).toBe(false);
	expect(sound.toggleMute()).toBe(true);
	expect(sound.muted).toBe(true);
	expect(sound.toggleMute()).toBe(false);
	expect(sound.muted).toBe(false);
});

test('master and per-bus volumes are settable and clamped to 0..1', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(sound.masterVolume).toBe(1);
	sound.setMasterVolume(0.5);
	expect(sound.masterVolume).toBe(0.5);
	sound.setMasterVolume(2);
	expect(sound.masterVolume).toBe(1);
	sound.setMasterVolume(-1);
	expect(sound.masterVolume).toBe(0);

	expect(sound.busVolume('combat')).toBe(1);
	sound.setBusVolume('combat', 0.25);
	expect(sound.busVolume('combat')).toBe(0.25);
	sound.setBusVolume('combat', 5);
	expect(sound.busVolume('combat')).toBe(1);
});

test('mixer setters never throw when disabled', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(() => {
		sound.setMuted(true);
		sound.setMasterVolume(0.3);
		sound.setBusVolume('movement', 0.7);
		sound.toggleMute();
	}).not.toThrow();
});

// Persistence seam (#150, ADR 0015): the system applies saved prefs on init and
// reports its current prefs for write-through, both decoupled from the fs (the
// ConfigStore does the I/O). applyAudioPrefs is a load, not a user change, so it
// must NOT fire onChange and trigger a redundant write.
test('applyAudioPrefs restores saved state and round-trips through audioPrefs', () => {
	const sound = new SoundSystem({ isTTY: false });
	const saved = {
		master: 0.4,
		muted: true,
		buses: { combat: 0.2, movement: 0.6, ui: 0.8 },
	};
	sound.applyAudioPrefs(saved);
	expect(sound.audioPrefs()).toEqual(saved);
	expect(sound.masterVolume).toBe(0.4);
	expect(sound.muted).toBe(true);
	expect(sound.busVolume('movement')).toBe(0.6);
});

test('applyAudioPrefs clamps stored values and does not fire onChange', () => {
	const sound = new SoundSystem({ isTTY: false });
	let changes = 0;
	sound.onChange = () => changes++;
	sound.applyAudioPrefs({
		master: 9,
		muted: false,
		buses: { combat: -1, movement: 0.5, ui: 2 },
	});
	expect(sound.masterVolume).toBe(1);
	expect(sound.busVolume('combat')).toBe(0);
	expect(sound.busVolume('ui')).toBe(1);
	expect(changes).toBe(0); // a load, not a user edit
});

// Sound robustness (#268): an engine `error` event used to flip enabled=false on the
// very first hiccup, permanently and silently killing audio for the session. Transient
// errors (a per-voice glitch, momentary voice-pool exhaustion on a room switch) must be
// tolerated; only a sustained burst degrades to silence.
test('a single transient engine error does not permanently disable audio', () => {
	const sound = new SoundSystem({ isTTY: false });
	sound.enabled = true; // simulate a live engine
	let degraded = 0;
	sound.onDegraded = () => degraded++;
	(sound as unknown as { handleEngineError(e: Error): void }).handleEngineError(
		new Error('voice pool exhausted'),
	);
	expect(sound.enabled).toBe(true);
	expect(degraded).toBe(0); // a transient error must not surface a degrade warning
});

test('audio degrades to silence and surfaces once after a sustained burst of engine errors', () => {
	const sound = new SoundSystem({ isTTY: false });
	sound.enabled = true;
	let degraded = 0;
	sound.onDegraded = () => degraded++;
	const fire = (
		sound as unknown as { handleEngineError(e: Error): void }
	).handleEngineError.bind(sound);
	// A handful of errors is still tolerated...
	for (let i = 0; i < 8; i++) fire(new Error('glitch'));
	expect(sound.enabled).toBe(true);
	expect(degraded).toBe(0);
	// ...but a sustained fault past the limit finally degrades to silence, surfacing a
	// single visible warning on the enabled→disabled edge.
	fire(new Error('glitch'));
	expect(sound.enabled).toBe(false);
	expect(degraded).toBe(1);
	// Further errors after degrade must not re-fire the warning.
	fire(new Error('glitch'));
	expect(degraded).toBe(1);
});

test('every user-facing mixer change notifies onChange for write-through', () => {
	const sound = new SoundSystem({ isTTY: false });
	let changes = 0;
	sound.onChange = () => changes++;
	sound.setMasterVolume(0.5);
	sound.setBusVolume('ui', 0.3);
	sound.setMuted(true);
	sound.toggleMute();
	expect(changes).toBe(4);
});
