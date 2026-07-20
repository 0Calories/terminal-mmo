import type { AnimationId } from '@mmo/core/sprites';
import type { Sprite } from './sprite';

// The *art* half of a Form: the named Animation grids plus their anchors and per-animation
// animation rate. Forms are compiled from `.sprite` files (ADR 0031); the art
// registry lives in `forms.ts`. Animation *selection* (bodyFrame) lives in @mmo/core.
export interface BodySprite {
	frames: Partial<Record<AnimationId, Sprite | readonly Sprite[]>>;
	grip: { x: number; y: number };
	head: { x: number; y: number };
	baseline?: number;
	// Per-animation playback rate carried from a `.sprite` doc (ADR 0031); drives the
	// multi-frame emote frame index (see `bodyFrame`). Absent forms use EMOTE_FPS.
	fps?: Readonly<Record<string, number>>;
}

// How many frames this body's `walk` animation carries — the sim distance-
// indexes the gait into them (ADR 0035). A missing or single-frame walk is 1.
export function walkFrameCount(body: BodySprite): number {
	const walk = body.frames.walk;
	return Array.isArray(walk) ? walk.length : 1;
}

export function formFrame(
	body: BodySprite,
	animationId: AnimationId,
	frameIndex = 0,
): Sprite {
	const frame = body.frames[animationId] ?? body.frames.idle;
	if (frame === undefined)
		throw new Error('BodySprite is missing its required `idle` Animation');
	if (Array.isArray(frame)) {
		const arr = frame as readonly Sprite[];
		const i = ((frameIndex % arr.length) + arr.length) % arr.length;
		return arr[i];
	}
	return frame as Sprite;
}
