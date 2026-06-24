import { BOX, COMBAT } from './constants';
import { HUES, type RGBAQuad, SCENE_PALETTE } from './sceneStyle';
import {
	type PlayerClass,
	type Skill,
	skillForSlot,
	skillHitbox,
	skillUnlocked,
} from './skills';
import { mirrorGlyph, spriteFor, type WeaponFrameId } from './sprites';
import type {
	ActionState,
	AttackPhase,
	Box,
	Effect,
	Entity,
	Facing,
	MoveId,
	SwingPhases,
	Tint,
} from './types';
import { DEFAULT_WEAPON, type Weapon, weaponById } from './weapons';

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

// The total committed duration of a swing under a given phase config. The phase
// functions interpret `attackT` (time remaining) against this total, so a weapon's
// own `swing` (ADR 0017 §14) reshapes the machine without any other change.
export function swingTotal(swing: SwingPhases = COMBAT.swing): number {
	return swing.windup + swing.active + swing.recovery;
}

// The default-attack total, retained as a constant for the unarmed/default path and
// the many call sites + tests that key off it (a weapon passes its own `swing`).
export const SWING_TOTAL = swingTotal();

// The phase of a basic swing for a given `attackT` (time remaining), or null when
// idle. Pure; the single source of truth for "what phase is this swing in". `swing`
// defaults to the standard attack — a weapon passes its own phase durations so the
// same function drives a slow greatsword and a fast dagger (ADR 0017 §14).
export function swingPhase(
	attackT: number,
	swing: SwingPhases = COMBAT.swing,
): AttackPhase | null {
	if (attackT <= 0) return null;
	const elapsed = swingTotal(swing) - attackT;
	if (elapsed < swing.windup) return 'windup';
	if (elapsed < swing.windup + swing.active) return 'active';
	return 'recovery';
}

// Progress 0..1 through the CURRENT phase, for render interpolation (pose lean,
// arc sweep). 0 at a phase's start, →1 at its end. Idle reads 0.
export function swingProgress(
	attackT: number,
	swing: SwingPhases = COMBAT.swing,
): number {
	const phase = swingPhase(attackT, swing);
	if (!phase) return 0;
	const { windup, active, recovery } = swing;
	const elapsed = swingTotal(swing) - attackT;
	if (phase === 'windup') return windup > 0 ? elapsed / windup : 1;
	if (phase === 'active') return active > 0 ? (elapsed - windup) / active : 1;
	return recovery > 0 ? (elapsed - windup - active) / recovery : 1;
}

// The melee hitbox is live ONLY during the active phase (ADR 0017 §1).
export function meleeActive(
	attackT: number,
	swing: SwingPhases = COMBAT.swing,
): boolean {
	return swingPhase(attackT, swing) === 'active';
}

// --- Dodge phase machine (ADR 0017 §5) --------------------------------------
//
// The Dodge is the swing machine's sibling: one scalar `dodgeT` (time remaining)
// runs an `active` window (i-frames) then a `recovery` tail (exposed, committed).
// It reuses the AttackPhase value names so it round-trips through the same
// action-state — only `active` and `recovery` ever appear (a Dodge has no wind-up).

export const DODGE_TOTAL = COMBAT.dodge.active + COMBAT.dodge.recovery;

// The full re-dodge lockout (ADR 0017 §5): the hop (active + recovery) plus the
// `cooldown` tail, armed as `dodgeCdT` on the start tick and counted down. Anchoring
// the whole lockout at dodge start — rather than detecting recovery-end — keeps the
// spam-gate a single scalar set beside `dodgeT`, while leaving `dodgeT` (i-frames +
// replication) untouched. Outlives `dodgeT` by exactly `cooldown`.
export const DODGE_LOCKOUT = DODGE_TOTAL + COMBAT.dodge.cooldown;

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

// The TIMING half of the Dodge gate (ADR 0017 §5): the server-authoritative, tick-
// stable preconditions — off cooldown (`dodgeCdT`, the spam-gate), not mid-Dodge, not
// mid-swing, not Staggered. These survive the hop, so `resolveCombat` re-checks them
// post-physics to load `dodgeT` (the i-frame window) without trusting the client on
// cooldown. The movement half (grounded + moving) lives in `canStartDodge` only.
export function dodgeReady(e: Entity): boolean {
	return (
		(e.dodgeCdT ?? 0) <= 0 &&
		(e.dodgeT ?? 0) <= 0 &&
		e.attackT <= 0 &&
		(e.stunT ?? 0) <= 0
	);
}

// Whether an Avatar can START a fresh Dodge this tick (ADR 0017 §5): the full gate —
// `dodgeReady` timing PLUS grounded while holding a direction (`moveX !== 0`). A Dodge
// is an earned, committed reposition: no air-dodge, no standstill panic-hop. Evaluated
// ONLY at the client/sim impulse site, BEFORE the hop's upward pop ungrounds the body —
// the movement conditions cannot be re-derived post-physics, so the caller authors a
// gated `dodge` intent that `resolveCombat` trusts (client-authoritative movement, ADR
// 0001). The hop direction is `moveX`, so the same signal gates the move and aims it.
export function canStartDodge(e: Entity, moveX: number): boolean {
	return dodgeReady(e) && e.onGround && moveX !== 0;
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
// staggered sprite, a guard/parry stance, a dodge after-image). `staggered` is Hitstun
// in flight; `guarding` is a raised Guard and `parrying` its opening window (ADR 0017
// §5) — set together so a parrier reads as both guarding and flashing; `dodging` is the
// i-frame hop (ADR 0017 §5). Round-trips as the action's u8; an airborne bit joins as
// later slices land.
export const ACTION_FLAG = {
	staggered: 1,
	guarding: 2,
	parrying: 4,
	dodging: 8,
} as const;

// The reaction/defense flags an entity broadcasts this tick: `staggered` (Hitstun in
// flight), the Guard stance derived from `guardT` (`guarding` whenever raised, `parrying`
// during its opening window), and `dodging` (an i-frame hop in flight) — so Stagger,
// Guard/Parry, AND Dodge are visible to everyone (ADR 0017 §3/§5/§10), for Avatars and
// Monsters alike. The bits OR together.
export function actionFlags(e: Entity): number {
	let flags = (e.stunT ?? 0) > 0 ? ACTION_FLAG.staggered : 0;
	const guard = guardPhase(e.guardT ?? 0);
	if (guard) flags |= ACTION_FLAG.guarding;
	if (guard === 'parry') flags |= ACTION_FLAG.parrying;
	if ((e.dodgeT ?? 0) > 0) flags |= ACTION_FLAG.dodging;
	return flags;
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
export function superArmorActive(
	e: Entity,
	swing: SwingPhases = COMBAT.swing,
): boolean {
	return swingPhase(e.attackT, swing) === 'windup';
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
export function actionStateOf(
	e: Entity,
	swing: SwingPhases = COMBAT.swing,
): ActionState {
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
	const phase = swingPhase(e.attackT, swing);
	if (!phase) return flags ? { ...IDLE_ACTION, flags } : IDLE_ACTION;
	return {
		move: 'basic',
		phase,
		progress: swingProgress(e.attackT, swing),
		flags,
	};
}

// --- Guard: Block + Parry (ADR 0017 §5) -------------------------------------
//
// Guard is ONE held input with a skill gradient, modeled — like the swing — by a
// single scalar, `guardT` on the Entity: seconds the Guard has been held this raise,
// counting UP from 0. Its magnitude IS the gradient: the opening window parries, held
// past it blocks. No tap-vs-hold measurement — the window is relative to press-time,
// which the gate already knows. Pure helpers; the owner predicts `guardT`, the server
// owns it authoritatively, and observers read the derived `flags` off the wire.

export type GuardPhase = 'parry' | 'block';

// The phase of a raised Guard for a given `guardT` (time held), or null when not
// guarding. The opening (0, parryWindow] is the Parry window; past it is a Block held
// for as long as the input is. The single source of truth for "is this a parry or a
// block", used for both rendering and the no-lag hit resolution.
export function guardPhase(
	guardT: number,
	cfg: typeof COMBAT.guard = COMBAT.guard,
): GuardPhase | null {
	if (guardT <= 0) return null;
	return guardT <= cfg.parryWindow ? 'parry' : 'block';
}

// Whether a guarding entity PARRIES a hit landing this tick (ADR 0017 §5/§11). The raw
// window is the opening of the raise; the server widens it by a lag-comp slack (seconds,
// derived from the input's client timestamp and clamped to `cfg.lagComp`) so a Parry the
// Player timed correctly on their delayed screen still resolves when the input lands a
// tick or two late and the server's `guardT` has already drifted into Block. Offline /
// zero-lag passes slack 0 → exactly the raw opening window. A tolerance, not a rewind.
export function parryActive(
	guardT: number,
	lagSlack = 0,
	cfg: typeof COMBAT.guard = COMBAT.guard,
): boolean {
	if (guardT <= 0) return false;
	return (
		guardT <= cfg.parryWindow + Math.min(Math.max(0, lagSlack), cfg.lagComp)
	);
}

// Whether `defender` faces TOWARD an attacker at `attackerX` — the frontal arc a Guard
// protects (ADR 0017 §5). A hit from behind (the defender facing away) ignores Guard,
// rewarding positioning without precise directional block inputs. An attacker sharing
// the defender's column is treated as frontal (ambiguous → the defender's favour).
export function facingToward(defender: Entity, attackerX: number): boolean {
	const side = Math.sign(attackerX - defender.x);
	return side === 0 || side === defender.facing;
}

// The outcome of resolving a frontal melee hit against a (possibly) guarding defender
// (ADR 0017 §5). PURE — it reads the defender's guard state + Poise and the incoming HP
// damage and returns what to apply, so `stepZone` (server) and any prediction share one
// gate and can't disagree:
//   - 'none'  : no Guard (or a rear hit) — full damage, the caller's normal path.
//   - 'parry' : caught in the opening window — negate the hit (0 HP) and dump
//               `attackerPoiseDump` Poise onto the ATTACKER (usually a break → punish).
//   - 'block' : held past the window — chip `hpDamage`, drain the defender's Poise, and
//               on a pool break flag a guard-break Stagger of the defender.
export interface GuardOutcome {
	result: 'none' | 'parry' | 'block';
	hpDamage: number; // HP the defender takes (0 parry / chip block / full none)
	defenderPoise: number; // the defender's new Poise pool
	guardBroke: boolean; // a Block emptied the pool → guard-break Stagger of the defender
	attackerPoiseDump: number; // Poise to deal to the ATTACKER (parry only, else 0)
}
export function resolveGuard(
	defender: Entity,
	attackerX: number,
	hpDamage: number,
	lagSlack = 0,
	cfg: typeof COMBAT.guard = COMBAT.guard,
): GuardOutcome {
	const guardT = defender.guardT ?? 0;
	const pool = defender.poise ?? COMBAT.poise.max;
	const none: GuardOutcome = {
		result: 'none',
		hpDamage,
		defenderPoise: pool,
		guardBroke: false,
		attackerPoiseDump: 0,
	};
	// Not guarding, or struck from behind → Guard does nothing.
	if (!guardPhase(guardT, cfg) || !facingToward(defender, attackerX))
		return none;
	// Parry: the opening window (lag-comp-extended) negates the hit and dumps Poise on
	// the attacker. Checked before Block so a window the lag slack rescues parries.
	if (parryActive(guardT, lagSlack, cfg))
		return {
			result: 'parry',
			hpDamage: 0,
			defenderPoise: pool,
			guardBroke: false,
			attackerPoiseDump: cfg.parryPoiseDamage,
		};
	// Block: chip the HP and drain Poise toward a guard-break. Reuse applyPoiseDamage so
	// the guard-break uses the same accumulating-pool break the rest of combat does — a
	// blocked flurry empties the pool and Staggers the turtling defender.
	const { poise, broke } = applyPoiseDamage(defender, cfg.blockPoise);
	return {
		result: 'block',
		hpDamage: Math.ceil(hpDamage * cfg.blockChip),
		defenderPoise: poise,
		guardBroke: broke,
		attackerPoiseDump: 0,
	};
}

// The parry-clash Effect a successful Parry emits (ADR 0017 §5/§13d): a bright, sharp
// flash at the defender, biased back along the blow. Its intensity is fixed (the hit's
// damage was negated, so it does NOT scale with damage) — the clash is about the catch,
// not the blow. Like the impact burst it carries NO `source`, so it reaches everyone in
// range including the parrier, who needs it for the clash flash + camera juice + sound.
export function parryEffect(defender: Entity, dir: Facing): Effect {
	return {
		kind: 'parry',
		x: defender.x + BOX.w / 2,
		y: defender.y + BOX.h / 2,
		intensity: COMBAT.poise.max,
		dir,
	};
}

// The world cell the guard-stance glyph occupies: just past the defender's leading
// edge at mid-height, so the brace reads as held up in front. Pure geometry, the guard
// twin of swingPoseCell.
export function guardPoseCell(e: Entity): { x: number; y: number } {
	return { x: e.facing === 1 ? e.x + BOX.w : e.x - 1, y: e.y + 1 };
}

// The guard-stance glyph for a phase: a solid brace when Blocking, a brighter sigil in
// the Parry window so the opening reads at a glance. Symmetric (facing is handled by the
// cell position), a pure function of phase — the seam the renderer blits with its colour.
export function guardPoseGlyph(phase: GuardPhase): string {
	return phase === 'parry' ? '◇' : '┃';
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

// The Dodge after-image is a self-contained client visual effect spawned on the
// dodge-start edge and ticked on the render clock (see client `dodge-echo.ts`,
// ADR 0017 §13e) — decoupled from this timing, so the dodge needs no pure pose helper
// here. `dodgePhase`/`dodgeProgress` above still feed the replicated action-state.

// The composited weapon visual for a swing phase (ADR 0017 §13b/§14): the weapon's
// own glyph posed as the weapon tip, plus the slash-arc sweep glyph during the active
// phase. A PURE function of (move, phase, weapon, facing) ONLY — no entity, no
// renderer state — so the pose↔phase↔weapon mapping is deterministic and unit-tested,
// and the SAME weapon renders identically for its owner and every observer. Returns
// null when the move isn't a basic swing (idle / future moves draw no weapon accent).
export interface SwingPose {
	glyph: string; // weapon-tip accent, already oriented for facing
	arc: string | null; // slash-arc sweep glyph (active phase only), else null
}
export function swingPose(
	move: MoveId,
	phase: AttackPhase,
	weapon: Weapon,
	facing: Facing,
): SwingPose | null {
	if (move !== 'basic') return null;
	const glyph = facing === 1 ? weapon.glyph : mirrorGlyph(weapon.glyph);
	const arc = phase === 'active' ? (facing === 1 ? '╱' : '╲') : null;
	return { glyph, arc };
}

// The WeaponSprite frame-set an Avatar shows this frame (ADR 0018 §4): a PURE
// function of its action — `idle` (the always-visible hold pose) for any non-swing,
// else the swing phase's own frame id (`windup`/`active`/`recovery`). Pure and
// shared so the owner's prediction and every observer's render agree on the
// appearance frame-for-frame, the same family as swingPhase / swingProgress. The
// `active` phase is an ordered SWEEP, indexed by `sweepIndex(swingProgress, len)`.
export function weaponFrame(
	move: MoveId,
	phase: AttackPhase | null,
): WeaponFrameId {
	if (move !== 'basic' || phase === null) return 'idle';
	return phase;
}

// The frame of an `active` sweep that plays at a given `swingProgress` (ADR 0018 §4):
// the sweep is partitioned into `len` equal slices, first frame at progress 0, last at
// progress 1. Monotonic non-decreasing in progress; clamped to [0, len-1] so a progress
// at or past the active-phase boundary still resolves to a real frame. Pure + shared so
// owner-prediction and observer-render land on the SAME sweep frame. `len <= 1` → 0.
export function sweepIndex(progress: number, len: number): number {
	if (len <= 1) return 0;
	const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
	return Math.min(len - 1, Math.floor(p * len));
}

export function meleeHitbox(p: Entity, reach: number = COMBAT.meleeReach): Box {
	const w = reach;
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
	// `dodge` is the caller's ALREADY-GATED decision (ADR 0017 §5): the impulse site
	// runs the full `canStartDodge` (grounded + moving) before the hop ungrounds the
	// body and passes the result here, so this only re-checks the tick-stable timing
	// (`dodgeReady`) — it never re-derives the movement conditions post-physics. `guard`
	// raises the held Guard this tick (ADR 0017 §5).
	intent: {
		attack?: boolean;
		skill?: number;
		dodge?: boolean;
		guard?: boolean;
	},
	dt: number,
	weapon: Weapon = weaponById(DEFAULT_WEAPON),
): {
	hitbox: Box | null;
	damage: number;
	attackT: number;
	// Time remaining in the Dodge hop (ADR 0017 §5): the caller folds this back onto
	// the Entity, and on `dodgeStarted` applies the hop impulse to its momentum body.
	dodgeT: number;
	// Time remaining in the post-recovery re-dodge lockout (the spam-gate); the caller
	// folds it back onto the Entity as `dodgeCdT`. Outlives `dodgeT` by `cooldown`.
	dodgeCdT: number;
	dodgeStarted: boolean;
	cooldowns: Record<string, number>;
	skillFired?: Skill;
	// True on the tick a fresh swing begins (ADR 0017 §2): the caller clears the
	// per-swing hit list so the new swing can connect again, the rate-limiter that
	// replaced automatic post-hit i-frames.
	swingStarted: boolean;
	// Seconds the Guard has been held this raise (ADR 0017 §5): accumulates while the
	// guard intent is held and the entity is free to guard, resets to 0 otherwise. The
	// caller folds it onto `guardT`; rendering + hit resolution derive parry/block from it.
	guardT: number;
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
	const dodgeStarted = (intent.dodge ?? false) && dodgeReady(avatar);
	const dodgeT = dodgeStarted
		? DODGE_TOTAL
		: Math.max(0, (avatar.dodgeT ?? 0) - dt);
	// The spam-gate lockout (ADR 0017 §5): armed to the full lockout on the start tick,
	// otherwise just decays — so it lingers `cooldown` past `dodgeT` and bars the next
	// hop. The caller folds this onto `avatar.dodgeCdT`; `canStartDodge` reads it back.
	const dodgeCdT = dodgeStarted
		? DODGE_LOCKOUT
		: Math.max(0, (avatar.dodgeCdT ?? 0) - dt);

	// The basic swing is now a wind-up → active → recovery phase machine (ADR 0017
	// §1). A fresh swing starts only when idle (the prior swing has fully recovered),
	// loading the full sequence into attackT; the resulting phase is wind-up, so the
	// hitbox is NOT live on the start tick. The melee hitbox is projected on every
	// tick the swing is in its `active` phase — a Monster's i-frame (hurtT) gates the
	// multi-tick active window down to a single hit. A fired Skill still overrides the
	// shared hitbox slot and keeps its instant cooldown behavior (active-skill rework
	// is out of this slice's scope).
	// The basic swing, Dodge, and Guard are mutually exclusive (ADR 0017 §5): a swing
	// can't start while a Dodge is in flight (including the tick it begins) or while the
	// Guard is held, and the Guard can't rise mid-swing, mid-Dodge, or while Staggered —
	// so a hop, a raised brace, and an attack never coexist on one entity.
	const guarding = intent.guard === true;
	const starting =
		(intent.attack ?? false) && attackT <= 0 && dodgeT <= 0 && !guarding;
	const nextAttackT = starting ? swingTotal(weapon.swing) : attackT;
	// Accumulate the held-guard timer only when free to guard (not mid-swing, not
	// mid-Dodge, not Staggered); any other tick resets it to 0 (a fresh raise reopens the
	// Parry window). Clamped just past the Parry+lag window so an indefinite Block doesn't
	// grow `guardT` unbounded while still reading as a Block.
	const canGuard =
		guarding && nextAttackT <= 0 && dodgeT <= 0 && (avatar.stunT ?? 0) <= 0;
	const guardT = canGuard
		? Math.min(
				(avatar.guardT ?? 0) + dt,
				COMBAT.guard.parryWindow + COMBAT.guard.lagComp + dt,
			)
		: 0;
	let hitbox: Box | null = meleeActive(nextAttackT, weapon.swing)
		? meleeHitbox(avatar, weapon.reach)
		: null;
	let damage: number = weapon.damage;
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
		dodgeCdT,
		dodgeStarted,
		cooldowns: decayed,
		skillFired,
		swingStarted: starting,
		guardT,
	};
}
