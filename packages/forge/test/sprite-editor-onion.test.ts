import { describe, expect, test } from 'bun:test';
import { ghostColor, previousGhostFrame } from '../src/sprite-editor/onion';

const POSE = ['a', 'b', 'c', 'd', 'e'] as const;

describe('previousGhostFrame — the one Frame that ghosts', () => {
	test('ghosts the immediate previous Frame', () => {
		expect(previousGhostFrame(POSE, 'c')).toBe('b');
	});

	test('wraps: the first Frame ghosts the last', () => {
		expect(previousGhostFrame(POSE, 'a')).toBe('e');
	});

	test('a single-Frame Animation has no neighbour to ghost', () => {
		expect(previousGhostFrame(['solo'], 'solo')).toBeNull();
	});

	test('an unknown active Frame yields nothing', () => {
		expect(previousGhostFrame(POSE, 'zzz')).toBeNull();
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

		expect(Math.abs(far[0] - bg[0])).toBeLessThan(Math.abs(near[0] - bg[0]));
		expect(far[3]).toBe(255);
	});
});
