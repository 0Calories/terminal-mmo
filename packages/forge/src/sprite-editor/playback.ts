// Pure animation-playback math for the Sprite editor (ADR 0031, issue #339).
// Playback is presentation — it never mutates the doc or history. The TUI holds
// the wall-clock elapsed time and asks these functions which frame/animation to show
// this tick, so the logic stays deterministic and unit-testable without a clock.
import { EMOTE_FPS } from '@mmo/core/sprites';

// Which frame of a `frameCount`-long animation is showing after `elapsedS` seconds at
// `fps`. A single-frame (or empty) animation is always frame 0; a non-positive fps
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

// The animation's playback fps: its authored value, or the shared EMOTE_FPS default.
export function animationFps(
	fpsMap: Readonly<Record<string, number>>,
	animation: string,
): number {
	return fpsMap[animation] ?? EMOTE_FPS;
}

// Walk-cycle preview simulates stride against the `walk` animation the same way
// the sim does (ADR 0035): each preview step advances one stride, indexing
// `step % frameCount`. STRIDE governs *sim* distance-per-step, not wall-clock
// cadence, so the preview uses a fixed brisk rate rather than deriving from
// STRIDE.
export const WALK_PREVIEW_FPS = 4;

export function walkPreviewIndex(
	frameCount: number,
	elapsedS: number,
	fps: number = WALK_PREVIEW_FPS,
): number {
	if (frameCount <= 1) return 0;
	const step = Math.floor(Math.max(0, elapsedS) * fps);
	return step % frameCount;
}
