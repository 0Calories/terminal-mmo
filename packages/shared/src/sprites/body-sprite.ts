import { emoteById } from '../emote';
import type { AttackPhase, Facing, MoveId } from '../types';
import { buddy } from './forms/buddy';
import { wisp } from './forms/wisp';
import type { Sprite } from './sprite';

export type EmotePoseId = `emote:${string}`;
export type PoseId =
	| 'idle'
	| 'walkA'
	| 'walkB'
	| 'jump'
	| 'windup'
	| 'active'
	| 'recovery'
	| 'hurt'
	| EmotePoseId;

export interface BodySprite {
	frames: Partial<Record<PoseId, Sprite | readonly Sprite[]>>;
	grip: { x: number; y: number };
	head: { x: number; y: number };
	baseline?: number;
}

export const FORMS: readonly BodySprite[] = [buddy];

// Kept so the `wisp` import stays live while drafted out of FORMS.
export const DRAFTED_FORMS: readonly BodySprite[] = [wisp];

export const DEFAULT_FORM = 0;

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

export const STRIDE = 6;

export const EMOTE_FPS = 5;

export interface BodyState {
	move: MoveId;
	phase: AttackPhase | null;
	swingProgress: number;
	emote: string | null;
	emoteT: number;
	airborne: boolean;
	moving: boolean;
	distanceX: number;
	staggered: boolean;
}

export function bodyFrame(s: BodyState): {
	poseId: PoseId;
	frameIndex: number;
} {
	if (s.staggered) return { poseId: 'hurt', frameIndex: 0 };
	if (s.move === 'basic' && s.phase !== null)
		return { poseId: s.phase, frameIndex: 0 };
	if (s.airborne) return { poseId: 'jump', frameIndex: 0 };
	if (s.moving) {
		const stride = Math.floor(Math.abs(s.distanceX) / STRIDE);
		return { poseId: stride % 2 === 0 ? 'walkA' : 'walkB', frameIndex: 0 };
	}
	if (s.emote) {
		const hold = emoteById(s.emote)?.lifetime === 'hold';
		return {
			poseId: `emote:${s.emote}`,
			frameIndex: hold ? 0 : Math.floor(Math.max(0, s.emoteT) * EMOTE_FPS),
		};
	}
	return { poseId: 'idle', frameIndex: 0 };
}

export function mirrorAnchorX(
	x: number,
	width: number,
	facing: Facing,
): number {
	return facing === 1 ? x : width - 1 - x;
}
