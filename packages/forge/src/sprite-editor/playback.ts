// Pure animation-playback math for the Sprite editor (ADR 0031, issue #339).
// Playback is presentation — it never mutates the doc or history. The TUI holds
// the wall-clock elapsed time and asks these functions which frame/pose to show
// this tick, so the logic stays deterministic and unit-testable without a clock.
import { EMOTE_FPS } from '@mmo/core';

// Which frame of a `frameCount`-long pose is showing after `elapsedS` seconds at
// `fps`. A single-frame (or empty) pose is always frame 0; a non-positive fps
// freezes on frame 0.
export function playbackFrame(
	frameCount: number,
	elapsedS: number,
	fps: number,
): number {
	if (frameCount <= 1) return 0;
	if (!Number.isFinite(fps) || fps <= 0) return 0;
	const step = Math.floor(Math.max(0, elapsedS) * fps);
	return ((step % frameCount) + frameCount) % frameCount;
}

// The pose's playback fps: its authored value, or the shared EMOTE_FPS default.
export function poseFps(
	fpsMap: Readonly<Record<string, number>>,
	pose: string,
): number {
	return fpsMap[pose] ?? EMOTE_FPS;
}

// Walk-cycle preview alternates walkA/walkB so the artist sees the gait. STRIDE
// governs *sim* distance-per-swap, not wall-clock cadence, so the preview uses a
// fixed brisk rate rather than deriving from STRIDE.
export const WALK_PREVIEW_FPS = 4;

export function walkPreviewPose(
	elapsedS: number,
	fps: number = WALK_PREVIEW_FPS,
): 'walkA' | 'walkB' {
	const step = Math.floor(Math.max(0, elapsedS) * fps);
	return step % 2 === 0 ? 'walkA' : 'walkB';
}
