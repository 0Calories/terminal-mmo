import type { AttackPhase, Facing, MoveId } from '../types';
import { buddy } from './forms/buddy';
import type { Sprite } from './sprite';

// The Poses a BodySprite may animate through (ADR 0020 §1). `idle`, `walkA`, `walkB`
// are the required core every Form must author; `jump`, the combat leans
// (`windup`/`active`/`recovery`), `hurt`, and the per-emote frames (`emote:<id>`) are
// optional and fall back to `idle` when absent (§5). A pose is a WHOLE frame, not a
// composited skeleton — at terminal fidelity a limb is one cell, so animating is just
// redrawing the grid. A multi-frame value (`Sprite[]`) is a loop/sweep the selector
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

// A BodySprite is the animated body of an entity (ADR 0020 §1) — the body analogue of
// the WeaponSprite: a named set of whole-frame Poses plus the per-body grip and head
// anchors that let an equipped weapon and a cosmetic hat ride on ANY Form (ADR 0018
// §3). Entity-agnostic by design: an Avatar Form is one BodySprite today, and Monsters
// become a consumer when they animate later. Every Avatar keeps the SAME logical box;
// a Form changes only this art (§3).
export interface BodySprite {
	// The authored Pose grids. `idle`/`walkA`/`walkB` are required by the authoring
	// contract; everything else is optional (the selector falls back to `idle`). A
	// `Sprite[]` value is a multi-frame loop/sweep indexed by the selector's frameIndex.
	frames: Partial<Record<PoseId, Sprite | readonly Sprite[]>>;
	// The "hand" cell (right-facing art coords) an equipped WeaponSprite aligns to,
	// grip-to-grip; mirrored across the body on facing (ADR 0018 §3).
	grip: { x: number; y: number };
	// The head cell (right-facing art coords) the cosmetic hat centres over and sits
	// above; mirrored across the body on facing (ADR 0018 §3, the same anchor mechanism).
	head: { x: number; y: number };
}

// The Form registry (ADR 0020 §4): a flat array of BodySprites selected by the
// `cosmetics.form` index, riding the same appearance rails as HATS / hues. Append-only
// and Form-keyed so a second Form is pure data later. Index 0 is the launch humanoid.
export const FORMS: readonly BodySprite[] = [buddy];

export const DEFAULT_FORM = 0;

// Clamp-to-default Form lookup (mirrors weaponById / clampCosmetics): an out-of-range
// or forward-version index can never crash the renderer — it falls back to FORMS[0].
export function formById(i: number | undefined): BodySprite {
	if (i === undefined || !Number.isInteger(i) || i < 0 || i >= FORMS.length)
		return FORMS[DEFAULT_FORM];
	return FORMS[i];
}

// The concrete Pose grid a BodySprite shows for a selected (poseId, frameIndex), with
// the authoring contract's fallback baked in (ADR 0020 §5): an unauthored Pose resolves
// to `idle`, so a Form is usable after only its `idle`/`walkA`/`walkB` core and every
// other Pose can be added later without touching the render path. A multi-frame Pose is
// sampled by `frameIndex` (wrapped into range); the body is ALWAYS drawn, so this never
// returns null (unlike the weapon layer, which may draw nothing).
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

// The travelled |Δx| (in cells) between walk-cycle flips (ADR 0020 §7): the gait is
// driven by accumulated horizontal distance, not a clock, so it costs no new wire data
// and the owner and every observer compute the identical foot frame-for-frame.
export const STRIDE = 6;

// Frames-per-second an emote Pose's multi-frame sweep advances at (ADR 0020 §9): the
// selector samples `emote:<id>` by `floor(emoteT * EMOTE_FPS)`, wrapped into range by
// `formFrame`, so a two-frame wave alternates as its `emoteT` counts down. A single-
// frame emote ignores it (every index wraps to 0). Derived from the replicated
// `emoteT`, so the owner and every observer animate the identical frame.
export const EMOTE_FPS = 5;

// The state the body Pose is selected from — the replicated signals a BodySprite poses
// against every frame (ADR 0020 §1/§6/§7). Mirrors the WeaponSprite's `(move, phase,
// swingProgress)` but broader: it also reads locomotion (airborne/moving/distanceX),
// reaction (staggered), and the active emote.
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

// The Pose an Avatar's body shows this frame (ADR 0020 §6): a PURE function of its
// replicated state, the body analogue of `weaponFrame`. The precedence ladder is fixed
// —  `hurt/stagger > combat (windup/active/recovery) > airborne > walk > emote > idle`
// — so owner prediction and every observer's render agree frame-for-frame. The one
// deliberate choice is that WALKING CANCELS AN EMOTE (§6): an emote is a "standing
// still and posing" moment. The walk cycle flips `walkA↔walkB` every STRIDE cells of
// travelled |Δx| (§7), freezing when idle or airborne. Returns the DESIRED Pose; an
// unauthored one falls back to `idle` at `formFrame` — so until a Form authors walk /
// jump / combat / emote frames, the body simply holds idle while the seam stays live.
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
	if (s.emote)
		return {
			poseId: `emote:${s.emote}`,
			frameIndex: Math.floor(Math.max(0, s.emoteT) * EMOTE_FPS),
		};
	return { poseId: 'idle', frameIndex: 0 };
}

// The leading-edge hand column of a Pose, reflected across the body when facing left —
// the shared mirror the renderer applies to the grip/head anchors so a composited
// weapon/hat lands correctly on either facing (ADR 0018 §3).
export function mirrorAnchorX(
	x: number,
	width: number,
	facing: Facing,
): number {
	return facing === 1 ? x : width - 1 - x;
}
