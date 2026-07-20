// Headless tests for the pure animation-playback math (issue #339).
import { describe, expect, test } from 'bun:test';
import { EMOTE_FPS } from '@mmo/core/sprites';
import {
	animationFps,
	playbackFrame,
	WALK_PREVIEW_FPS,
	walkPreviewIndex,
} from '../src/sprite-editor/playback';

describe('playbackFrame', () => {
	test('cycles frames at the given fps', () => {
		// 4 fps over a 3-frame animation: 0.0s→0, 0.25s→1, 0.5s→2, 0.75s→0 (wrap).
		expect(playbackFrame(3, 0, 4)).toBe(0);
		expect(playbackFrame(3, 0.25, 4)).toBe(1);
		expect(playbackFrame(3, 0.5, 4)).toBe(2);
		expect(playbackFrame(3, 0.75, 4)).toBe(0);
		expect(playbackFrame(3, 1.0, 4)).toBe(1);
	});

	test('a custom (higher) fps advances faster', () => {
		expect(playbackFrame(2, 0.1, 10)).toBe(1);
		expect(playbackFrame(2, 0.2, 10)).toBe(0);
	});

	test('a single-frame animation is always frame 0', () => {
		expect(playbackFrame(1, 5, 30)).toBe(0);
		expect(playbackFrame(0, 5, 30)).toBe(0);
	});

	test('a non-positive fps freezes on frame 0', () => {
		expect(playbackFrame(4, 10, 0)).toBe(0);
		expect(playbackFrame(4, 10, -5)).toBe(0);
	});
});

describe('animationFps', () => {
	const doc = {
		id: 'x',
		key: 'p',
		baseline: 0,
		anchors: {},
		colors: {},
		animations: [
			{
				name: 'idle',
				frames: [{ rows: ['A'], colors: ['p'], bg: [' '], anchors: {} }],
			},
			{
				name: 'walk',
				fps: 8,
				frames: [
					{ rows: ['A'], colors: ['p'], bg: [' '], anchors: {} },
					{ rows: ['B'], colors: ['p'], bg: [' '], anchors: {} },
				],
			},
		],
	} as const;
	test('uses the authored value when present', () => {
		expect(animationFps(doc, 'walk')).toBe(8);
	});
	test('falls back to EMOTE_FPS when absent', () => {
		expect(animationFps(doc, 'idle')).toBe(EMOTE_FPS);
	});
});

describe('walkPreviewIndex', () => {
	test('simulates stride against the walk animation at the preview cadence', () => {
		expect(walkPreviewIndex(2, 0)).toBe(0);
		expect(walkPreviewIndex(2, 1 / WALK_PREVIEW_FPS)).toBe(1);
		expect(walkPreviewIndex(2, 2 / WALK_PREVIEW_FPS)).toBe(0);
	});

	test('a longer walk cycle uses every frame', () => {
		expect(walkPreviewIndex(3, 2 / WALK_PREVIEW_FPS)).toBe(2);
		expect(walkPreviewIndex(3, 3 / WALK_PREVIEW_FPS)).toBe(0);
	});

	test('a single-frame (or empty) walk freezes on frame 0', () => {
		expect(walkPreviewIndex(1, 5)).toBe(0);
		expect(walkPreviewIndex(0, 5)).toBe(0);
	});
});
