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
	// Per-pose animation rate carried from a `.sprite` doc (ADR 0031); consumed
	// by a later animation slice. Absent for TS-authored forms.
	fps?: Readonly<Record<string, number>>;
}

export const FORMS: readonly BodySprite[] = [buddy];

// Kept so the `wisp` import stays live while drafted out of FORMS.
export const DRAFTED_FORMS: readonly BodySprite[] = [wisp];

export function formById(id: string | number | undefined): BodySprite {
	// Tolerant during the number->string cosmetics.form migration: a known string
	// id resolves, any other string (or out-of-range number) falls back to the
	// default form. A later slice makes this string-only.
	if (typeof id === 'string') {
		return id === 'buddy' ? buddy : FORMS[DEFAULT_FORM];
	}
	if (id === undefined || !Number.isInteger(id) || id < 0 || id >= FORMS.length)
		return FORMS[DEFAULT_FORM];
	return FORMS[id];
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
