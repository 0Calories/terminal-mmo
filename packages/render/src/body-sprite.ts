import { DEFAULT_FORM, type PoseId } from '@mmo/core';
import { buddy } from './forms/buddy';
import { wisp } from './forms/wisp';
import type { Sprite } from './sprite';

// The *art* half of a Form: the named Pose grids plus their anchors. Pose *selection*
// (bodyFrame) and the registry count (FORM_COUNT) live in @mmo/core.
export interface BodySprite {
	frames: Partial<Record<PoseId, Sprite | readonly Sprite[]>>;
	grip: { x: number; y: number };
	head: { x: number; y: number };
	baseline?: number;
}

export const FORMS: readonly BodySprite[] = [buddy];

// Kept so the `wisp` import stays live while drafted out of FORMS.
export const DRAFTED_FORMS: readonly BodySprite[] = [wisp];

export function formById(i: number | undefined): BodySprite {
	if (i === undefined || !Number.isInteger(i) || i < 0 || i >= FORMS.length)
		return FORMS[DEFAULT_FORM];
	return FORMS[i];
}

export function formFrame(
	body: BodySprite,
	poseId: PoseId,
	frameIndex = 0,
): Sprite {
	const frame = body.frames[poseId] ?? body.frames.idle;
	if (frame === undefined)
		throw new Error('BodySprite is missing its required `idle` Pose');
	if (Array.isArray(frame)) {
		const arr = frame as readonly Sprite[];
		const i = ((frameIndex % arr.length) + arr.length) % arr.length;
		return arr[i];
	}
	return frame as Sprite;
}
