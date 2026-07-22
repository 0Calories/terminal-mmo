import { EMOTE_FPS } from '@mmo/core/sprites';
import type { SpriteDoc } from '@mmo/render';

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

export function animationFps(doc: SpriteDoc, animation: string): number {
	return doc.animations.find((a) => a.name === animation)?.fps ?? EMOTE_FPS;
}

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
