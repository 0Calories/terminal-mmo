// Renders a SynthSpec into an in-memory PCM16 mono WAV buffer (ADR 0014). Just
// math over samples — no I/O, no audio engine — so it's fully unit-testable headlessly.

export type Wave = 'square' | 'triangle' | 'sine' | 'noise';

export interface SynthSpec {
	wave: Wave;
	freq: number; // start frequency in Hz (ignored for `noise`)
	freqEnd?: number; // sweep target; defaults to `freq` (no sweep)
	durationMs: number;
	attackMs?: number; // linear fade-in (default 2ms, declick)
	releaseMs?: number; // linear fade-out (default 40ms)
	volume?: number; // peak amplitude 0..1 (default 0.6)
}

export const SAMPLE_RATE = 44100;
const WAV_HEADER_BYTES = 44;

// Deterministic value noise keyed by sample index, so a noise render is byte-stable
// (reproducible builds + golden tests). Math.imul keeps the hash in 32-bit lanes.
function noiseAt(i: number): number {
	let x = Math.imul(i + 1, 2654435761);
	x ^= x << 13;
	x ^= x >>> 17;
	x ^= x << 5;
	return ((x >>> 0) / 0xffffffff) * 2 - 1;
}

// One oscillator cycle sampled at phase ∈ [0,1), output in [-1, 1].
function oscillator(wave: Exclude<Wave, 'noise'>, phase: number): number {
	switch (wave) {
		case 'square':
			return phase < 0.5 ? 1 : -1;
		case 'triangle': {
			const t = phase * 2;
			return t < 1 ? -1 + 2 * t : 3 - 2 * t;
		}
		case 'sine':
			return Math.sin(2 * Math.PI * phase);
	}
}

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++)
		view.setUint8(offset + i, text.charCodeAt(i));
}

function writeHeader(view: DataView, sampleCount: number): void {
	const dataBytes = sampleCount * 2;
	const byteRate = SAMPLE_RATE * 2;
	writeAscii(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(view, 8, 'WAVE');
	writeAscii(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // PCM fmt chunk size
	view.setUint16(20, 1, true); // audioFormat = PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, 2, true); // blockAlign = channels * bytes/sample
	view.setUint16(34, 16, true); // bitsPerSample
	writeAscii(view, 36, 'data');
	view.setUint32(40, dataBytes, true);
}

export function renderWav(spec: SynthSpec): Uint8Array {
	const freqEnd = spec.freqEnd ?? spec.freq;
	const volume = spec.volume ?? 0.6;
	const n = Math.max(1, Math.round((spec.durationMs / 1000) * SAMPLE_RATE));
	const attack = (Math.max(0, spec.attackMs ?? 2) / 1000) * SAMPLE_RATE;
	const release = (Math.max(0, spec.releaseMs ?? 40) / 1000) * SAMPLE_RATE;

	const buffer = new ArrayBuffer(WAV_HEADER_BYTES + n * 2);
	const view = new DataView(buffer);
	writeHeader(view, n);

	let phase = 0;
	for (let i = 0; i < n; i++) {
		const frac = n <= 1 ? 0 : i / (n - 1);
		const freq = spec.freq + (freqEnd - spec.freq) * frac;
		phase += freq / SAMPLE_RATE;
		phase -= Math.floor(phase);

		const raw =
			spec.wave === 'noise' ? noiseAt(i) : oscillator(spec.wave, phase);

		let env = 1;
		if (attack > 0 && i < attack) env = i / attack;
		if (release > 0 && i > n - release) env = Math.min(env, (n - i) / release);

		const amp = Math.max(-1, Math.min(1, raw * env * volume));
		view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(amp * 32767), true);
	}
	return new Uint8Array(buffer);
}
