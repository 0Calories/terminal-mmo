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
