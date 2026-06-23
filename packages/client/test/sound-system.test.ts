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
