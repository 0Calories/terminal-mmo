// Headless tests for pure onion-skin sourcing (spec #387, issue #396). Ghosts
// are sourced by a pure function of a Pose's Frame list, the active Frame, and
// the onion depth — so wrapping, distance-falloff, tint and depth-0/playback
// suspension are all asserted here, state → expected, with no screen.
import { describe, expect, test } from 'bun:test';
import {
	cycleOnionDepth,
	ghostColor,
	ONION_MAX_DEPTH,
	onionGhosts,
} from '../src/sprite-editor/onion';

const POSE = ['a', 'b', 'c', 'd', 'e'] as const;

describe('cycleOnionDepth', () => {
	test('cycles 0 → 1 → 2 → 0 (wraps at the max)', () => {
		expect(cycleOnionDepth(0)).toBe(1);
		expect(cycleOnionDepth(1)).toBe(2);
		expect(cycleOnionDepth(2)).toBe(0);
		expect(ONION_MAX_DEPTH).toBe(2);
	});
});

describe('onionGhosts — which Frames ghost at which tint/intensity', () => {
	test('depth 0 yields no ghosts (onion off / suspended in playback)', () => {
		expect(onionGhosts(POSE, 'c', 0)).toEqual([]);
	});

	test('depth 1 ghosts the immediate previous (red) and next (blue) Frame', () => {
		const g = onionGhosts(POSE, 'c', 1);
		expect(g).toEqual([
			{ frame: 'b', tint: 'prev', intensity: 1 },
			{ frame: 'd', tint: 'next', intensity: 1 },
		]);
	});

	test('depth 2 reaches two Frames each way, intensity falling with distance', () => {
		const g = onionGhosts(POSE, 'c', 2);
		// Nearest first, prev before next at equal distance.
		expect(g).toEqual([
			{ frame: 'b', tint: 'prev', intensity: 1 },
			{ frame: 'd', tint: 'next', intensity: 1 },
			{ frame: 'a', tint: 'prev', intensity: 0.5 },
			{ frame: 'e', tint: 'next', intensity: 0.5 },
		]);
	});

	test('wraps within the Pose at both ends', () => {
		// Active is the first Frame: its previous wraps to the last.
		const first = onionGhosts(POSE, 'a', 1);
		expect(first).toEqual([
			{ frame: 'e', tint: 'prev', intensity: 1 },
			{ frame: 'b', tint: 'next', intensity: 1 },
		]);
		// Active is the last Frame: its next wraps to the first.
		const last = onionGhosts(POSE, 'e', 1);
		expect(last.map((g) => g.frame)).toEqual(['d', 'a']);
	});

	test('a single-Frame Pose has no neighbour to ghost', () => {
		expect(onionGhosts(['solo'], 'solo', 2)).toEqual([]);
	});

	test('an unknown active Frame yields nothing', () => {
		expect(onionGhosts(POSE, 'zzz', 2)).toEqual([]);
	});

	test('a ghost that wraps back onto the active Frame is dropped', () => {
		// Two-Frame Pose at depth 2: distance-2 both ways lands on the active
		// Frame and is dropped, leaving only the distance-1 neighbour (twice).
		const g = onionGhosts(['x', 'y'], 'x', 2);
		expect(g.every((gh) => gh.frame !== 'x')).toBe(true);
		expect(g.map((gh) => gh.frame)).toEqual(['y', 'y']);
	});
});

describe('ghostColor — tint blended over the canvas background', () => {
	const bg: [number, number, number, number] = [16, 18, 26, 255];

	test('previous ghosts read red (r > b), next ghosts read blue (b > r)', () => {
		const [pr, , pb] = ghostColor('prev', 1, bg);
		expect(pr).toBeGreaterThan(pb);
		const [nr, , nb] = ghostColor('next', 1, bg);
		expect(nb).toBeGreaterThan(nr);
	});

	test('lower intensity fades further toward the canvas background', () => {
		const near = ghostColor('prev', 1, bg);
		const far = ghostColor('prev', 0.5, bg);
		// The farther (dimmer) ghost sits closer to the bg red than the near one.
		expect(Math.abs(far[0] - bg[0])).toBeLessThan(Math.abs(near[0] - bg[0]));
		expect(far[3]).toBe(255);
	});
});
