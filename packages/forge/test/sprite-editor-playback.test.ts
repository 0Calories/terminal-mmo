// Headless tests for the pure animation-playback math (issue #339).
import { describe, expect, test } from 'bun:test';
import { EMOTE_FPS } from '@mmo/core';
import {
	playbackFrame,
	poseFps,
	WALK_PREVIEW_FPS,
	walkPreviewPose,
} from '../src/sprite-editor/playback';

describe('playbackFrame', () => {
	test('cycles frames at the given fps', () => {
		// 4 fps over a 3-frame pose: 0.0s→0, 0.25s→1, 0.5s→2, 0.75s→0 (wrap).
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

	test('a single-frame pose is always frame 0', () => {
		expect(playbackFrame(1, 5, 30)).toBe(0);
		expect(playbackFrame(0, 5, 30)).toBe(0);
	});

	test('a non-positive fps freezes on frame 0', () => {
		expect(playbackFrame(4, 10, 0)).toBe(0);
		expect(playbackFrame(4, 10, -5)).toBe(0);
	});
});

describe('poseFps', () => {
	test('uses the authored value when present', () => {
		expect(poseFps({ walkA: 8 }, 'walkA')).toBe(8);
	});
	test('falls back to EMOTE_FPS when absent', () => {
		expect(poseFps({}, 'idle')).toBe(EMOTE_FPS);
	});
});

describe('walkPreviewPose', () => {
	test('alternates walkA/walkB at the preview cadence', () => {
		expect(walkPreviewPose(0)).toBe('walkA');
		expect(walkPreviewPose(1 / WALK_PREVIEW_FPS)).toBe('walkB');
		expect(walkPreviewPose(2 / WALK_PREVIEW_FPS)).toBe('walkA');
	});
});
