import { expect, test } from 'bun:test';
import { renderWav, SAMPLE_RATE, type SynthSpec } from '../src/sound/synth';

const JUMP: SynthSpec = {
	wave: 'square',
	freq: 320,
	freqEnd: 660,
	durationMs: 120,
};

function ascii(bytes: Uint8Array, offset: number, len: number): string {
	return String.fromCharCode(...bytes.slice(offset, offset + len));
}

test('renders a well-formed PCM16 mono WAV header', () => {
	const wav = renderWav(JUMP);
	expect(ascii(wav, 0, 4)).toBe('RIFF');
	expect(ascii(wav, 8, 4)).toBe('WAVE');
	expect(ascii(wav, 12, 4)).toBe('fmt ');
	expect(ascii(wav, 36, 4)).toBe('data');

	const view = new DataView(wav.buffer);
	expect(view.getUint16(20, true)).toBe(1); // PCM
	expect(view.getUint16(22, true)).toBe(1); // mono
	expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
	expect(view.getUint16(34, true)).toBe(16); // bits/sample
});

test('sample count matches the requested duration', () => {
	const wav = renderWav({ ...JUMP, durationMs: 100 });
	const expectedSamples = Math.round((100 / 1000) * SAMPLE_RATE);
	// 44-byte header + 2 bytes per mono PCM16 sample.
	expect(wav.length).toBe(44 + expectedSamples * 2);

	const view = new DataView(wav.buffer);
	expect(view.getUint32(40, true)).toBe(expectedSamples * 2); // data chunk size
});

test('render is deterministic — identical spec yields identical bytes', () => {
	const a = renderWav({ wave: 'noise', freq: 0, durationMs: 50 });
	const b = renderWav({ wave: 'noise', freq: 0, durationMs: 50 });
	expect(a).toEqual(b);
});

test('zero volume produces pure silence', () => {
	const wav = renderWav({ ...JUMP, volume: 0 });
	const view = new DataView(wav.buffer);
	for (let i = 44; i < wav.length; i += 2)
		expect(view.getInt16(i, true)).toBe(0);
});

test('a degenerate (sub-frame) duration still emits at least one sample', () => {
	const wav = renderWav({ ...JUMP, durationMs: 0 });
	expect(wav.length).toBe(44 + 2);
});
