import { emoteById } from '../entities/emote';
import type { AttackPhase, Facing, MoveId } from '../entities/types';

export type EmoteAnimationId = `emote:${string}`;
export type AnimationId =
	| 'idle'
	| 'walk'
	| 'jump'
	| 'windup'
	| 'active'
	| 'recovery'
	| 'hurt'
	| EmoteAnimationId;

export function swingFrameIndex(phase: AttackPhase): 0 | 1 | 2 {
	if (phase === 'windup') return 0;
	if (phase === 'active') return 1;
	return 2;
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

export function bodyFrame(
	s: BodyState,

	fps?: Readonly<Record<string, number>>,

	walkFrameCount = 2,
): {
	animationId: AnimationId;
	frameIndex: number;
} {
	if (s.staggered) return { animationId: 'hurt', frameIndex: 0 };
	if (s.move === 'basic' && s.phase !== null)
		return { animationId: s.phase, frameIndex: 0 };
	if (s.airborne) return { animationId: 'jump', frameIndex: 0 };
	if (s.moving) {
		const stride = Math.floor(Math.abs(s.distanceX) / STRIDE);
		const count = Math.max(1, Math.floor(walkFrameCount));
		return { animationId: 'walk', frameIndex: stride % count };
	}
	if (s.emote) {
		const animationId: EmoteAnimationId = `emote:${s.emote}`;
		const hold = emoteById(s.emote)?.lifetime === 'hold';
		const rate = fps?.[animationId] ?? EMOTE_FPS;
		return {
			animationId,
			frameIndex: hold ? 0 : Math.floor(Math.max(0, s.emoteT) * rate),
		};
	}
	return { animationId: 'idle', frameIndex: 0 };
}

export function mirrorAnchorX(
	x: number,
	width: number,
	facing: Facing,
): number {
	return facing === 1 ? x : width - 1 - x;
}
