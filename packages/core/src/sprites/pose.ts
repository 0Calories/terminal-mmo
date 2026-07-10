import { emoteById } from '../entities/emote';
import type { AttackPhase, Facing, MoveId } from '../entities/types';

// Pose *selection* + pose identity — the deterministic, art-free half of a sprite
// that the shared sim reasons about (owner and observers must agree on the Pose;
// the actual glyph grids live in @mmo/render).

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
	// Per-pose playback rates (art-authored, replicated via the compiled body,
	// ADR 0031). Selection stays deterministic: a multi-frame emote's frame index
	// is emoteT × the pose's fps. A pose absent from the map uses EMOTE_FPS, so a
	// body that declares no custom rate animates exactly as before.
	fps?: Readonly<Record<string, number>>,
): {
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
		const poseId: EmotePoseId = `emote:${s.emote}`;
		const hold = emoteById(s.emote)?.lifetime === 'hold';
		const rate = fps?.[poseId] ?? EMOTE_FPS;
		return {
			poseId,
			frameIndex: hold ? 0 : Math.floor(Math.max(0, s.emoteT) * rate),
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
