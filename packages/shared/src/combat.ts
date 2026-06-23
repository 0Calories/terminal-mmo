import { BOX, COMBAT } from './constants';
import { HUES, type RGBAQuad, SCENE_PALETTE } from './sceneStyle';
import {
	type PlayerClass,
	type Skill,
	skillForSlot,
	skillHitbox,
	skillUnlocked,
} from './skills';
import { spriteFor } from './sprites';
import type {
	ActionState,
	AttackPhase,
	Box,
	Effect,
	Entity,
	Facing,
	Tint,
} from './types';

const BODY_PALETTE: Record<string, RGBAQuad> = SCENE_PALETTE;

// The body colour to tint an entity's death gore with (#139): an Avatar uses its
// chosen cosmetic hue (a stray index falls back to the default), every other
// entity uses its sprite's dominant body colour (the sprite `defaultKey`). One
// lookup off the shared sprite/palette data so the tint can't drift from the art.
export function entityTint(e: Entity): Tint {
	const quad =
		e.cosmetics !== undefined
			? (HUES[e.cosmetics.hue] ?? HUES[0])
			: (BODY_PALETTE[spriteFor(e.type).defaultKey] ?? BODY_PALETTE.p);
	return { r: quad[0], g: quad[1], b: quad[2] };
}

// The gore Effect a death emits (ADR 0013, #139): a high-intensity radial (dir 0)
// burst at the dying entity's centre, tinted to the dead entity's body colour, so
// a kill sprays in every direction with chunkier, entity-coloured gore — visibly
// distinct from a chip hit's fine maroon blood. Shared so Monster and Avatar death
// — server and offline — produce identical bursts. Carries no `source`: it is sent
// to everyone in range (the killer sees it too).
export function deathGoreEffect(e: Entity): Effect {
	return {
		kind: 'gore',
		x: e.x + BOX.w / 2,
		y: e.y + BOX.h / 2,
		intensity: COMBAT.deathBurstIntensity,
		dir: 0,
		tint: entityTint(e),
	};
}

export function entityBox(e: Entity): Box {
	return { x: e.x, y: e.y, w: BOX.w, h: BOX.h };
}

// --- Basic-swing phase machine (ADR 0017 §1) --------------------------------
//
// A swing is modeled by a single scalar, `attackT` on the Entity: the time
// REMAINING in the whole swing (wind-up + active + recovery), counting down to 0
// (idle/ready). `elapsed = SWING_TOTAL - attackT` walks the three phases in order.
// Folding the whole machine onto the one existing field keeps the snapshot cheap
// (the action-state is derived, not stored extra) and means client prediction and
// the server share the exact same scalar through `resolveCombat`.

export const SWING_TOTAL =
	COMBAT.swing.windup + COMBAT.swing.active + COMBAT.swing.recovery;

// The phase of a basic swing for a given `attackT` (time remaining), or null when
// idle. Pure; the single source of truth for "what phase is this swing in".
export function swingPhase(attackT: number): AttackPhase | null {
	if (attackT <= 0) return null;
	const elapsed = SWING_TOTAL - attackT;
	if (elapsed < COMBAT.swing.windup) return 'windup';
	if (elapsed < COMBAT.swing.windup + COMBAT.swing.active) return 'active';
	return 'recovery';
}

// Progress 0..1 through the CURRENT phase, for render interpolation (pose lean,
// arc sweep). 0 at a phase's start, →1 at its end. Idle reads 0.
export function swingProgress(attackT: number): number {
	const phase = swingPhase(attackT);
	if (!phase) return 0;
	const { windup, active, recovery } = COMBAT.swing;
	const elapsed = SWING_TOTAL - attackT;
	if (phase === 'windup') return windup > 0 ? elapsed / windup : 1;
	if (phase === 'active') return active > 0 ? (elapsed - windup) / active : 1;
	return recovery > 0 ? (elapsed - windup - active) / recovery : 1;
}

// The melee hitbox is live ONLY during the active phase (ADR 0017 §1).
export function meleeActive(attackT: number): boolean {
	return swingPhase(attackT) === 'active';
}

// The action-state every entity replicates when idle: no move, no live hitbox.
export const IDLE_ACTION: ActionState = {
	move: 'idle',
	phase: 'recovery',
	progress: 0,
	flags: 0,
};

// The action-state to broadcast for an entity, derived from its swing timer
// (`attackT`). In this slice only Avatars run the phase machine; the snapshot
// builder calls this for Avatars and replicates IDLE_ACTION for Monsters (their
// offense rework is a later slice). Pure — the wire field is computed, not stored.
export function actionStateOf(e: Entity): ActionState {
	const phase = swingPhase(e.attackT);
	if (!phase) return IDLE_ACTION;
	return { move: 'basic', phase, progress: swingProgress(e.attackT), flags: 0 };
}

// --- Slash-arc + per-phase pose realization data (ADR 0017 §13a/b) ----------
//
// Pure, framework-agnostic geometry/glyph data the client blits with its own
// colour. Kept in @mmo/shared (alongside the phase machine it realizes) so the
// pose↔phase mapping is deterministic and unit-tested, not buried in the renderer.

// The weapon-tip pose glyph for a swing phase, oriented for `facing`: cocked-back
// on wind-up, swept level on active, trailing-low on recovery. The diagonal flips
// with facing; the level bar is symmetric. A minimal per-phase pose accent (a full
// body re-pose system is deferred) — but it is a pure function of (phase, facing),
// exactly the seam ADR 0017 §13a names.
export function swingPoseGlyph(phase: AttackPhase, facing: Facing): string {
	const right = phase === 'windup' ? '╲' : phase === 'active' ? '─' : '╱';
	if (facing === 1) return right;
	return right === '╲' ? '╱' : right === '╱' ? '╲' : right;
}

// The world cell the pose-accent glyph occupies for an entity mid-swing: just past
// its leading edge, raised on wind-up, mid on active, low on recovery — so the
// accent reads as the weapon arcing down through the swing. Pure geometry.
export function swingPoseCell(
	e: Entity,
	phase: AttackPhase,
): { x: number; y: number } {
	const lead = e.facing === 1 ? e.x + BOX.w : e.x - 1;
	const row =
		phase === 'windup' ? e.y : phase === 'active' ? e.y + 1 : e.y + BOX.h - 1;
	return { x: lead, y: row };
}

export function meleeHitbox(p: Entity): Box {
	const w = COMBAT.meleeReach;
	return {
		x: p.facing === 1 ? p.x + BOX.w : p.x - w,
		y: p.y,
		w,
		h: BOX.h,
	};
}

export function aabbOverlap(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

// The blood Effect a landed hit on a Monster emits (ADR 0013): one burst at the
// Monster's centre, biased along the attacker's facing, scaled by the damage
// dealt. Shared so the authoritative `stepZone` and the client's outgoing-hit
// prediction produce identical Effects. `source` attributes the burst to the
// attacking session for originator-suppression; the client predictor omits it
// (predicted Effects are never reported upward).
export function bloodEffect(
	m: Entity,
	attackerFacing: Facing,
	damage: number,
	source?: number,
): Effect {
	const e: Effect = {
		kind: 'blood',
		x: m.x + BOX.w / 2,
		y: m.y + BOX.h / 2,
		intensity: damage,
		dir: attackerFacing,
	};
	if (source !== undefined) e.source = source;
	return e;
}

// The blood Effect an Avatar taking damage emits (ADR 0013, #132): one burst at
// the Avatar's centre, biased AWAY from the damage source (`dir` 0 = radial when
// the direction is ambiguous), scaled by the damage taken. Unlike monster-hit
// blood this is server-sourced only — never predicted — and carries NO `source`,
// so the per-recipient snapshot filter delivers it to everyone in range including
// the victim, landing in sync with the hurt-flash.
export function hurtBloodEffect(
	a: Entity,
	dir: -1 | 0 | 1,
	damage: number,
): Effect {
	return {
		kind: 'blood',
		x: a.x + BOX.w / 2,
		y: a.y + BOX.h / 2,
		intensity: damage,
		dir,
	};
}

// The blood Effects the local Avatar's outgoing hit produces this tick, mirroring
// stepZone's monster-hit emission (same i-frame gate, centre, dir, intensity) so
// the predicted burst matches the authoritative one the server suppresses back to
// the attacker (ADR 0013). Pure; the client feeds these straight to its particle
// system for zero-latency feedback. No rollback on mispredict — a stray splat on
// a swing the server scores as a miss is acceptable.
export function predictHitEffects(
	hitbox: Box,
	attackerFacing: Facing,
	damage: number,
	monsters: Entity[],
): Effect[] {
	const effects: Effect[] = [];
	for (const m of monsters)
		if (m.hurtT <= 0 && aabbOverlap(hitbox, entityBox(m)))
			effects.push(bloodEffect(m, attackerFacing, damage));
	return effects;
}

// The one shared, pure resolution of an Avatar's combat Intent for a tick: the
// swing/skill/cooldown/hitbox/damage gate that both the authoritative server
// step (`resolveAvatarIntent` in zone.ts) and the client's optimistic
// prediction (the frame loop in client/src/index.ts) run, so the two can never
// diverge. Owns the per-tick decay of `attackT` AND every skill cooldown (the
// caller decays `hurtT` separately — that stays with vitals). Pure: inputs are
// never mutated; the returned `cooldowns` is a fresh clone.
//
// `dt` is in SECONDS, consistent with stepZone (which clamps dtMs/1000 before
// calling) and the client (which passes its own clamped `dtSec`).
export function resolveCombat(
	avatar: Entity,
	cooldowns: Record<string, number>,
	level: number,
	cls: PlayerClass,
	intent: { attack: boolean; skill?: number },
	dt: number,
): {
	hitbox: Box | null;
	damage: number;
	attackT: number;
	cooldowns: Record<string, number>;
	skillFired?: Skill;
} {
	const attackT = Math.max(0, avatar.attackT - dt);
	const decayed: Record<string, number> = {};
	for (const [id, cd] of Object.entries(cooldowns))
		decayed[id] = Math.max(0, cd - dt);

	// The basic swing is now a wind-up → active → recovery phase machine (ADR 0017
	// §1). A fresh swing starts only when idle (the prior swing has fully recovered),
	// loading the full sequence into attackT; the resulting phase is wind-up, so the
	// hitbox is NOT live on the start tick. The melee hitbox is projected on every
	// tick the swing is in its `active` phase — a Monster's i-frame (hurtT) gates the
	// multi-tick active window down to a single hit. A fired Skill still overrides the
	// shared hitbox slot and keeps its instant cooldown behavior (active-skill rework
	// is out of this slice's scope).
	const starting = intent.attack && attackT <= 0;
	const nextAttackT = starting ? SWING_TOTAL : attackT;
	let hitbox: Box | null = meleeActive(nextAttackT)
		? meleeHitbox(avatar)
		: null;
	let damage: number = COMBAT.meleeDamage;
	let skillFired: Skill | undefined;

	if (intent.skill) {
		const skill = skillForSlot(cls, intent.skill);
		if (skill && skillUnlocked(skill, level) && (decayed[skill.id] ?? 0) <= 0) {
			decayed[skill.id] = skill.cooldown;
			hitbox = skillHitbox(avatar, skill);
			damage = skill.damage;
			skillFired = skill;
		}
	}

	return {
		hitbox,
		damage,
		attackT: nextAttackT,
		cooldowns: decayed,
		skillFired,
	};
}
