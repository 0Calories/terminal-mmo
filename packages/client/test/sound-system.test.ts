import { expect, test } from 'bun:test';
import { SoundSystem } from '../src/sound/system';

test('without a TTY the audio facade stays disabled and safe to use', () => {
	const sound = new SoundSystem({ isTTY: false });
	expect(sound.enabled).toBe(false);
	expect(() => sound.play('jump')).not.toThrow();
	expect(() => sound.play('jump', { volume: 0.5, pan: -1 })).not.toThrow();
	expect(() => sound.dispose()).not.toThrow();
	expect(sound.enabled).toBe(false);
});

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
	expect(changes).toBe(0);
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
