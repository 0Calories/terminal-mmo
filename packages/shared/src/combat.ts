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

// --- Dodge phase machine (ADR 0017 §5) --------------------------------------
//
// The Dodge is the swing machine's sibling: one scalar `dodgeT` (time remaining)
// runs an `active` window (i-frames) then a `recovery` tail (exposed, committed).
// It reuses the AttackPhase value names so it round-trips through the same
// action-state — only `active` and `recovery` ever appear (a Dodge has no wind-up).

export const DODGE_TOTAL = COMBAT.dodge.active + COMBAT.dodge.recovery;

// The phase of a Dodge for a given `dodgeT` (time remaining), or null when not
// dodging. Pure; the single source of truth for the i-frame window.
export function dodgePhase(dodgeT: number): AttackPhase | null {
	if (dodgeT <= 0) return null;
	return DODGE_TOTAL - dodgeT < COMBAT.dodge.active ? 'active' : 'recovery';
}

// Progress 0..1 through the CURRENT Dodge phase, for the client hop pose.
export function dodgeProgress(dodgeT: number): number {
	const phase = dodgePhase(dodgeT);
	if (!phase) return 0;
	const { active, recovery } = COMBAT.dodge;
	const elapsed = DODGE_TOTAL - dodgeT;
	if (phase === 'active') return active > 0 ? elapsed / active : 1;
	return recovery > 0 ? (elapsed - active) / recovery : 1;
}

// The i-frame window: a Dodge negates incoming hits ONLY during its `active`
// phase (ADR 0017 §5). The `recovery` tail is vulnerable — the whole point of the
// committal. Pure; the universal "can this Avatar be hit" gate folds this in.
export function dodgeInvulnerable(e: Entity): boolean {
	return dodgePhase(e.dodgeT ?? 0) === 'active';
}

// Whether an Avatar can START a fresh Dodge this tick (ADR 0017 §5): only when it
// is free — not mid-Dodge (committal), not mid-swing, and not Staggered. The shared
// gate so the client physics prediction (which applies the hop impulse) and
// `resolveCombat` (which loads `dodgeT`) agree on exactly when a Dodge begins.
export function canStartDodge(e: Entity): boolean {
	return (e.dodgeT ?? 0) <= 0 && e.attackT <= 0 && (e.stunT ?? 0) <= 0;
}

// The universal "can this Avatar take a hit this tick" gate (ADR 0017 §5): blocked
// by either automatic i-frames (`hurtT`, set on a connect) or earned Dodge i-frames.
// One predicate so every Avatar damage site — Monster melee, projectiles — honours a
// Dodge identically.
export function avatarHittable(a: Entity): boolean {
	return a.hurtT <= 0 && !dodgeInvulnerable(a);
}

// The action-state `flags` bitfield (ADR 0017 §10): a compact set of reaction /
// defense bits replicated for every entity so a client can render the state (a
// staggered sprite, a dodge after-image). `staggered` (Hitstun) and `dodging` (the
// i-frame hop, ADR 0017 §5) exist now; guarding / airborne join as later slices
// land. Round-trips as the action's u8.
export const ACTION_FLAG = { staggered: 1, dodging: 2 } as const;

// The reaction/defense flags an entity broadcasts this tick: `staggered` (Hitstun in
// flight) and `dodging` (an i-frame hop in flight, ADR 0017 §5) — surfacing reaction
// /defense state through the action-state exactly as ADR 0017 §3/§10 requires, so a
// co-present Player can see the Dodge. The bits OR together.
export function actionFlags(e: Entity): number {
	return (
		((e.stunT ?? 0) > 0 ? ACTION_FLAG.staggered : 0) |
		((e.dodgeT ?? 0) > 0 ? ACTION_FLAG.dodging : 0)
	);
}

// The action-state every entity replicates when idle: no move, no live hitbox.
export const IDLE_ACTION: ActionState = {
	move: 'idle',
	phase: 'recovery',
	progress: 0,
	flags: 0,
};

// --- Poise + hit-reaction (ADR 0017 §2/§3) ----------------------------------
//
// Poise is an accumulating pool that regulates whether a hit Staggers at all. A
// hit always deals HP damage but only Staggers on a Poise BREAK (the pool driven to
// 0). The pool regenerates under no pressure, so weak sustained chip eventually
// breaks a target while a single light hit never does. Pure; the server tracks the
// pool on the Entity and the client never sees it (off-wire).

// Super-armor (ADR 0017 §3): while an attacker is in its own attack wind-up, a hit
// chips its Poise but cannot break it — so a jab can't interrupt a committed heavy
// swing. A pure function of the swing timer, symmetric for every entity.
export function superArmorActive(e: Entity): boolean {
	return swingPhase(e.attackT) === 'windup';
}

// Apply a hit's poise damage to an entity, returning its new pool and whether the
// hit BROKE it. A break refills the pool (the Stagger is the cost); Super-armor
// (wind-up) suppresses a break, clamping the chipped pool at 0 so the next hit out
// of wind-up breaks immediately. Pure — the caller folds `poise` back onto the
// Entity and, on a break, applies Hitstun + the Knockback impulse.
export function applyPoiseDamage(
	e: Entity,
	poiseDamage: number,
): { poise: number; broke: boolean } {
	const max = COMBAT.poise.max;
	const cur = e.poise ?? max;
	if (superArmorActive(e))
		return { poise: Math.max(0, cur - poiseDamage), broke: false };
	const next = cur - poiseDamage;
	if (next <= 0) return { poise: max, broke: true };
	return { poise: next, broke: false };
}

// Regenerate an entity's Poise toward full by one tick (ADR 0017 §3). Always-on
// regen is the MVP of "regenerates under no pressure" — a hit depletes far faster
// than this refills, preserving the chip-then-break rhythm. Pure.
export function regenPoise(e: Entity, dt: number): number {
	return Math.min(
		COMBAT.poise.max,
		(e.poise ?? COMBAT.poise.max) + COMBAT.poise.regen * dt,
	);
}

// The action-state to broadcast for an entity, derived from its swing timer
// (`attackT`). In this slice only Avatars run the phase machine; the snapshot
// builder calls this for Avatars and replicates IDLE_ACTION for Monsters (their
// offense rework is a later slice). Pure — the wire field is computed, not stored.
export function actionStateOf(e: Entity): ActionState {
	const flags = actionFlags(e);
	// A Dodge takes precedence over the swing for the `move` slot (you cannot do both
	// at once); its active/recovery phases reuse the AttackPhase names (ADR 0017 §5).
	const dPhase = dodgePhase(e.dodgeT ?? 0);
	if (dPhase)
		return {
			move: 'dodge',
			phase: dPhase,
			progress: dodgeProgress(e.dodgeT ?? 0),
			flags,
		};
	const phase = swingPhase(e.attackT);
	if (!phase) return flags ? { ...IDLE_ACTION, flags } : IDLE_ACTION;
	return { move: 'basic', phase, progress: swingProgress(e.attackT), flags };
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

// The Dodge after-image (ADR 0017 §5/§13a): a motion-streak glyph drawn behind the
// hopping Avatar — bright/sharp during the i-frame `active` window, a fading trail
// through `recovery` — so the hop reads as a quick evasive dash and the invulnerable
// frames are legible. Pure (phase, facing) → glyph, the same seam as the swing pose.
export function dodgePoseGlyph(phase: AttackPhase, facing: Facing): string {
	const trail = phase === 'active' ? '»' : '·';
	return facing === 1 ? trail : trail === '»' ? '«' : trail;
}

// The world cell the after-image occupies: just BEHIND the Avatar's trailing edge
// (opposite its facing), mid-body — the space it just vacated. Pure geometry.
export function dodgePoseCell(e: Entity): { x: number; y: number } {
	const back = e.facing === 1 ? e.x - 1 : e.x + BOX.w;
	return { x: back, y: e.y + 1 };
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

// The impact Effect a Poise-break emits (ADR 0017 §13d): a heavier, sharper burst
// than a chip `blood`, biased along the attacker's facing and scaled up from the
// damage dealt so a Stagger reads visibly bigger than a chip. It is the wire signal
// the client realizes into the impact-spark particle burst AND keys hitstop +
// camera-kick off (a break is the only "big moment" in this slice). Like the death
// gore burst it carries NO `source` — it is delivered to everyone in range including
// the attacker, who needs it to fire the camera-kick (the client predicts only chip
// blood, so the spark never double-renders).
export function impactEffect(
	m: Entity,
	attackerFacing: Facing,
	damage: number,
): Effect {
	return {
		kind: 'impact',
		x: m.x + BOX.w / 2,
		y: m.y + BOX.h / 2,
		intensity: damage + COMBAT.poise.max, // bigger than a chip blood of the same damage
		dir: attackerFacing,
	};
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
	intent: { attack?: boolean; skill?: number; dodge?: boolean },
	dt: number,
): {
	hitbox: Box | null;
	damage: number;
	attackT: number;
	// Time remaining in the Dodge hop (ADR 0017 §5): the caller folds this back onto
	// the Entity, and on `dodgeStarted` applies the hop impulse to its momentum body.
	dodgeT: number;
	dodgeStarted: boolean;
	cooldowns: Record<string, number>;
	skillFired?: Skill;
	// True on the tick a fresh swing begins (ADR 0017 §2): the caller clears the
	// per-swing hit list so the new swing can connect again, the rate-limiter that
	// replaced automatic post-hit i-frames.
	swingStarted: boolean;
} {
	const attackT = Math.max(0, avatar.attackT - dt);
	const decayed: Record<string, number> = {};
	for (const [id, cd] of Object.entries(cooldowns))
		decayed[id] = Math.max(0, cd - dt);

	// The Dodge (ADR 0017 §5) resolves first: it both gates and is gated by the swing
	// (you cannot dodge mid-swing, nor swing on the tick a dodge starts). A fresh hop
	// loads DODGE_TOTAL only when the Avatar is free (`canStartDodge`); otherwise the
	// timer just decays. The hop IMPULSE is applied by the caller (it owns the
	// client-authoritative momentum body, ADR 0001) — here we only track its timing
	// for the i-frame window + replication.
	const dodgeStarted = (intent.dodge ?? false) && canStartDodge(avatar);
	const dodgeT = dodgeStarted
		? DODGE_TOTAL
		: Math.max(0, (avatar.dodgeT ?? 0) - dt);

	// The basic swing is now a wind-up → active → recovery phase machine (ADR 0017
	// §1). A fresh swing starts only when idle (the prior swing has fully recovered),
	// loading the full sequence into attackT; the resulting phase is wind-up, so the
	// hitbox is NOT live on the start tick. The melee hitbox is projected on every
	// tick the swing is in its `active` phase — a Monster's i-frame (hurtT) gates the
	// multi-tick active window down to a single hit. A fired Skill still overrides the
	// shared hitbox slot and keeps its instant cooldown behavior (active-skill rework
	// is out of this slice's scope).
	// A swing can't start while a Dodge is in flight (including the tick it begins) —
	// the two moves are mutually exclusive (ADR 0017 §5).
	const starting = (intent.attack ?? false) && attackT <= 0 && dodgeT <= 0;
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
		dodgeT,
		dodgeStarted,
		cooldowns: decayed,
		skillFired,
		swingStarted: starting,
	};
}
