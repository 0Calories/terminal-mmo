import { describe, expect, test } from 'bun:test';
import {
	Compositor,
	compositeOverInto,
	createCellOut,
	type MutableRGBA,
	type RGBA,
} from '../src/compositor';

/**
 * OPT-IN timing block (ADR 0038). Skipped unless MMO_BENCH is set, because CI
 * timing is noisy — it reports numbers and NEVER asserts a threshold, so it can
 * never fail `bun test` on a slow machine. The standalone harness at
 * `packages/render/bench/compositor-bench.ts` covers the crowded stress scene;
 * this block is the in-suite, `bun test`-discoverable smoke:
 *
 *   MMO_BENCH=1 bun test packages/render/test/compositor-bench.test.ts
 */
const SCENE_BG: RGBA = [16, 18, 26, 255];

function composeRepresentative(c: Compositor): void {
	c.clear();
	const subW = c.widthCells * 2;
	const subH = c.heightCells * 2;
	// Floor.
	c.fillPixelRect(0, subH - 4, subW, 4, [60, 90, 60, 255]);
	// Blocky "actors".
	for (let i = 0; i < 24; i++) {
		const bx = (i * 9) % (subW - 4);
		const by = (i * 5) % (subH - 6);
		c.fillPixelRect(bx, by, 3, 5, [
			(i * 41) % 256,
			(i * 83) % 256,
			(i * 17) % 256,
			255,
		] as RGBA);
		c.stampGlyph(bx >> 1, by >> 1, '@', [255, 240, 200, 255]);
	}
	// Translucent particles.
	for (let i = 0; i < 200; i++) {
		c.setPixel((i * 13) % subW, (i * 7) % subH, [
			(i * 53) % 256,
			(i * 29) % 256,
			(i * 97) % 256,
			120,
		] as RGBA);
	}
}

function encode(c: Compositor): number {
	const out = createCellOut();
	const fg: MutableRGBA = [0, 0, 0, 0];
	let sum = 0;
	for (let y = 0; y < c.heightCells; y++) {
		for (let x = 0; x < c.widthCells; x++) {
			c.readCellInto(x, y, out);
			const bg = out.bg[3] > 0 ? out.bg : SCENE_BG;
			compositeOverInto(out.fg, bg, fg);
			sum += fg[0];
		}
	}
	return sum;
}

describe.skipIf(!process.env.MMO_BENCH)('compositor timing (opt-in)', () => {
	test('representative viewport composes + encodes (reported, not asserted)', () => {
		const c = new Compositor(80, 24);
		for (let i = 0; i < 30; i++) {
			composeRepresentative(c);
			encode(c);
		}
		const iters = 300;
		let checksum = 0;
		const t0 = performance.now();
		for (let i = 0; i < iters; i++) {
			composeRepresentative(c);
			checksum += encode(c);
		}
		const per = (performance.now() - t0) / iters;
		console.log(
			`representative 80x24: ${per.toFixed(3)} ms/frame (~${(1000 / per).toFixed(0)} FPS)`,
		);
		// Sanity only — the scene composed something. No timing threshold.
		expect(checksum).toBeGreaterThan(0);
	});
});
