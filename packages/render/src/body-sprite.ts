import type { AnimationId } from '@mmo/core/sprites';
import type { Sprite } from './sprite';

export interface BodySprite {
	frames: Partial<Record<AnimationId, Sprite | readonly Sprite[]>>;
	grip: { x: number; y: number };
	head: { x: number; y: number };
	baseline?: number;

	fps?: Readonly<Record<string, number>>;
}

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
