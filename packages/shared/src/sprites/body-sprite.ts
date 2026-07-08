import { emoteById } from '../emote';
import type { AttackPhase, Facing, MoveId } from '../types';
import { buddy } from './forms/buddy';
import { wisp } from './forms/wisp';
import type { Sprite } from './sprite';

// `idle`/`walkA`/`walkB` are the required core; the rest are optional and fall back to
// `idle` when absent (ADR 0020 §5). A Pose is a whole frame, not a composited skeleton —
// at terminal fidelity a limb is one cell. A `Sprite[]` value is a loop the selector
// samples by `frameIndex`.
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

// The animated body of an entity: whole-frame Poses plus per-body grip/head anchors so a
// weapon and hat ride any Form (ADR 0018 §3). A Form changes only art, never the logical
// box (ADR 0020 §3).
export interface BodySprite {
	frames: Partial<Record<PoseId, Sprite | readonly Sprite[]>>;
	// Hand cell (right-facing coords) a weapon aligns to grip-to-grip; mirrored on facing (ADR 0018 §3).
	grip: { x: number; y: number };
	// Head cell (right-facing coords) the hat centres above; mirrored on facing (ADR 0018 §3).
	head: { x: number; y: number };
	// Cells added to `sy` so the whole figure drops to plant its feet row on the terrain
	// surface: `1` for ink-top contact feet, `0` to leave it unshifted (ADR 0021).
	baseline?: number;
}

// The Form registry selected by `cosmetics.form` index; append-only (ADR 0020 §4).
// wisp is drafted out pending art rework — re-add it here to ship (art kept below).
export const FORMS: readonly BodySprite[] = [buddy];

// Kept out of the shippable catalog; referenced so the `wisp` import stays live.
export const DRAFTED_FORMS: readonly BodySprite[] = [wisp];

export const DEFAULT_FORM = 0;

// An out-of-range or forward-version index falls back to FORMS[0] rather than crash.
export function formById(i: number | undefined): BodySprite {
	if (i === undefined || !Number.isInteger(i) || i < 0 || i >= FORMS.length)
		return FORMS[DEFAULT_FORM];
	return FORMS[i];
}

// An unauthored Pose falls back to `idle` (ADR 0020 §5); a multi-frame Pose is sampled by
// `frameIndex` wrapped into range. The body is always drawn, so this never returns null.
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

// Cells of travelled |Δx| between walk-cycle flips: distance-driven, not clock-driven, so
// owner and observers derive the identical foot with no extra wire data (ADR 0020 §7).
export const STRIDE = 6;

// FPS an emote sweep advances at: sampled `floor(emoteT * EMOTE_FPS)` off the replicated
// `emoteT`, so owner and observers animate the identical frame (ADR 0020 §9).
export const EMOTE_FPS = 5;

// The replicated signals the body Pose is selected from each frame (ADR 0020 §6).
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

// The desired Pose this frame from replicated state (ADR 0020 §6). Precedence is fixed
// (hurt > combat > airborne > walk > emote > idle) so owner and observers agree. The one
// non-obvious rule: walking cancels an emote — an emote is a "stand still and pose" moment.
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
		// A `hold` emote (e.g. `sit`) freezes on one Pose; oneshot/loop sweep by `emoteT`
		// (ADR 0020 §9). An unknown (forward-version) id falls back to idle, posing nothing.
		const hold = emoteById(s.emote)?.lifetime === 'hold';
		return {
			poseId: `emote:${s.emote}`,
			frameIndex: hold ? 0 : Math.floor(Math.max(0, s.emoteT) * EMOTE_FPS),
		};
	}
	return { poseId: 'idle', frameIndex: 0 };
}

// Reflects the grip/head anchor column across the body on a left facing, so a composited
// weapon/hat lands correctly either way (ADR 0018 §3).
export function mirrorAnchorX(
	x: number,
	width: number,
	facing: Facing,
): number {
	return facing === 1 ? x : width - 1 - x;
}
