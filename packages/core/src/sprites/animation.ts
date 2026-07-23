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

export type MonsterAnimationName =
	| 'idle'
	| 'windup'
	| 'attack'
	| 'recovery'
	| 'airborne';

export interface MonsterBodyState {
	move: MoveId;
	phase: AttackPhase | null;
	airborne: boolean;
}

/**
 * The pure Monster body-Animation selector (ADR 0039): an Attack phase names
 * its telegraph Animation — the active phase reads `attack` — off-ground reads
 * `airborne`, everything else rests on `idle`. Resolving a missing Animation
 * back to `idle` is the sprite registry's job, so an idle-only Monster renders
 * exactly as before.
 */
export function monsterAnimation(s: MonsterBodyState): MonsterAnimationName {
	if (s.move === 'basic' && s.phase !== null)
		return s.phase === 'active' ? 'attack' : s.phase;
	if (s.airborne) return 'airborne';
	return 'idle';
}

/**
 * Samples a phase-bound Animation by phase *progress*, never fps (the ADR 0036
 * weapon-swing rule): more frames smooth the telegraph but can never change
 * its duration or desync it from the hitbox timing.
 */
export function phaseFrameIndex(progress: number, frameCount: number): number {
	const count = Math.max(1, Math.floor(frameCount));
	return Math.min(count - 1, Math.max(0, Math.floor(progress * count)));
}

export function mirrorAnchorX(
	x: number,
	width: number,
	facing: Facing,
): number {
	return facing === 1 ? x : width - 1 - x;
}
