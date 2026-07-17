import { emoteById } from '../entities/emote';
import type { AttackPhase, Facing, MoveId } from '../entities/types';

// Animation *selection* + animation identity — the deterministic, art-free half of a sprite
// that the shared sim reasons about (owner and observers must agree on the Animation;
// the actual glyph grids live in @mmo/render).

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

export type WeaponFrameId = 'idle' | 'windup' | 'active' | 'recovery';

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
	// Per-animation playback rates (art-authored, replicated via the compiled body,
	// ADR 0031). Selection stays deterministic: a multi-frame emote's frame index
	// is emoteT × the animation's fps. An animation absent from the map uses EMOTE_FPS, so a
	// body that declares no custom rate animates exactly as before.
	fps?: Readonly<Record<string, number>>,
	// How many frames the body's `walk` animation carries (ADR 0035): the gait is
	// distance-indexed into them, so an artist adding a third walk frame extends
	// the cycle with no type change. Replicated art data, so owner and observers
	// agree. Defaults to the canonical two-frame gait.
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
