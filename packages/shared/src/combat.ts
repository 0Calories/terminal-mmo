import { BOX, BRUTE, COMBAT, MONSTER } from './constants';
import { applyImpulse } from './physics';
import { capabilityUnlocked } from './progression';
import { HUES, type RGBAQuad, SCENE_PALETTE } from './sceneStyle';
import {
	type PlayerClass,
	type Skill,
	skillForSlot,
	skillHitbox,
	skillUnlocked,
} from './skills';
import { spriteFor, type WeaponFrameId } from './sprites';
import type {
	ActionState,
	AttackPhase,
	Box,
	Effect,
	Entity,
	EntityType,
	Facing,
	MoveId,
	Projectile,
	Strike,
	Tint,
} from './types';
import { DEFAULT_WEAPON, type Weapon, weaponById } from './weapons';

const BODY_PALETTE: Record<string, RGBAQuad> = SCENE_PALETTE;

// An Avatar tints to its chosen cosmetic hue; every other entity to its sprite's
// dominant body colour — read off the shared sprite/palette data so the tint can't
// drift from the art (#139).
export function entityTint(e: Entity): Tint {
	const quad =
		e.cosmetics !== undefined
			? (HUES[e.cosmetics.hue] ?? HUES[0])
			: (BODY_PALETTE[spriteFor(e.type).defaultKey] ?? BODY_PALETTE.p);
	return { r: quad[0], g: quad[1], b: quad[2] };
}

export function entityBox(e: Entity): Box {
	return { x: e.x, y: e.y, w: BOX.w, h: BOX.h };
}

// A swing is one scalar, `attackT`: the time REMAINING in the wind-up→active→recovery
// sequence, counting down to 0. `elapsed = SWING_TOTAL - attackT` walks the phases.
// One field shared by client prediction and server through `resolveCombat`.

// A constant, not per-weapon: weapons never reshape the swing machine (ADR 0024).
export const SWING_TOTAL =
	COMBAT.swing.windup + COMBAT.swing.active + COMBAT.swing.recovery;

export function swingPhase(attackT: number): AttackPhase | null {
	if (attackT <= 0) return null;
	const { windup, active } = COMBAT.swing;
	const elapsed = SWING_TOTAL - attackT;
	if (elapsed < windup) return 'windup';
	if (elapsed < windup + active) return 'active';
	return 'recovery';
}

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

// The chaser and brute differ only in these tuned numbers, so one code path in
// `stepZone` drives both (ADR 0017 §9).
export interface MeleeProfile {
	damage: number; // HP an active-phase connect deals
	poise: number; // Poise damage the connect chips off the victim
	range: number; // commit when the target is within this |dx|
	aggro: number; // approach the target while within this |dx|
	deadzone: number; // hold ground inside this |dx| so facing doesn't flip-flop
	commitCd: number; // seconds to wait after a commit before committing the next
}

// Null for a non-committer (the ranged shooter, the player).
export function meleeProfileOf(type: EntityType): MeleeProfile | null {
	if (type === 'chaser')
		return {
			damage: MONSTER.meleeDamage,
			poise: COMBAT.poiseDamage,
			range: MONSTER.meleeRange,
			aggro: MONSTER.chaserAggro,
			deadzone: MONSTER.chaserDeadzone,
			commitCd: 0, // the chaser re-commits as soon as its swing recovers
		};
	if (type === 'brute')
		return {
			damage: BRUTE.meleeDamage,
			poise: BRUTE.meleePoise,
			range: BRUTE.meleeRange,
			aggro: BRUTE.aggro,
			deadzone: BRUTE.deadzone,
			commitCd: BRUTE.commitCooldown, // the brute pauses between heavy swings
		};
	return null;
}

// The Dodge is the swing machine's sibling: one scalar `dodgeT` running an `active`
// window (i-frames) then an exposed `recovery` tail. It reuses the AttackPhase names —
// but has no wind-up, so only `active` and `recovery` ever appear (ADR 0017 §5).
export const DODGE_TOTAL = COMBAT.dodge.active + COMBAT.dodge.recovery;

// The full re-dodge lockout, armed as `dodgeCdT` on the start tick. Anchoring it at
// dodge start — rather than detecting recovery-end — keeps the spam-gate a single
// scalar beside `dodgeT`, which it outlives by exactly `cooldown` (ADR 0017 §5).
export const DODGE_LOCKOUT = DODGE_TOTAL + COMBAT.dodge.cooldown;

export function dodgePhase(dodgeT: number): AttackPhase | null {
	if (dodgeT <= 0) return null;
	return DODGE_TOTAL - dodgeT < COMBAT.dodge.active ? 'active' : 'recovery';
}

export function dodgeProgress(dodgeT: number): number {
	const phase = dodgePhase(dodgeT);
	if (!phase) return 0;
	const { active, recovery } = COMBAT.dodge;
	const elapsed = DODGE_TOTAL - dodgeT;
	if (phase === 'active') return active > 0 ? elapsed / active : 1;
	return recovery > 0 ? (elapsed - active) / recovery : 1;
}

// A Dodge negates incoming hits only during its `active` phase; the `recovery` tail
// is deliberately vulnerable — the cost of the committal (ADR 0017 §5).
export function dodgeInvulnerable(e: Entity): boolean {
	return dodgePhase(e.dodgeT ?? 0) === 'active';
}

// The TIMING half of the Dodge gate: the tick-stable preconditions that survive the
// hop, so `resolveCombat` can re-check them post-physics without trusting the client
// on cooldown. The movement half (grounded + moving) lives in `canStartDodge`.
export function dodgeReady(e: Entity): boolean {
	return (
		(e.dodgeCdT ?? 0) <= 0 &&
		(e.dodgeT ?? 0) <= 0 &&
		e.attackT <= 0 &&
		(e.stunT ?? 0) <= 0
	);
}

// The full Dodge gate: `dodgeReady` timing plus grounded-while-holding-a-direction
// (no air-dodge, no standstill panic-hop). Must be evaluated at the impulse site
// BEFORE the hop's upward pop ungrounds the body — the movement conditions can't be
// re-derived post-physics, so the caller bakes the result into a `dodge` intent that
// `resolveCombat` trusts (client-authoritative movement, ADR 0001). The hop aims at
// `moveX`, so one signal both gates and directs it.
export function canStartDodge(e: Entity, moveX: number): boolean {
	return dodgeReady(e) && e.onGround && moveX !== 0;
}

// One "can this Avatar take a hit this tick" gate, blocked by automatic i-frames
// (`hurtT`) or earned Dodge i-frames, so every Avatar damage site honours a Dodge
// identically.
export function avatarHittable(a: Entity): boolean {
	return a.hurtT <= 0 && !dodgeInvulnerable(a);
}

// Reaction/defense bits replicated for every entity so a client can render the state
// (staggered sprite, guard stance, dodge after-image). Round-trips as the action's u8
// (ADR 0017 §10).
export const ACTION_FLAG = {
	staggered: 1,
	guarding: 2,
	dodging: 4,
} as const;

export function actionFlags(e: Entity): number {
	let flags = (e.stunT ?? 0) > 0 ? ACTION_FLAG.staggered : 0;
	if (guardRaised(e.guardT ?? 0)) flags |= ACTION_FLAG.guarding;
	if ((e.dodgeT ?? 0) > 0) flags |= ACTION_FLAG.dodging;
	return flags;
}

export const IDLE_ACTION: ActionState = {
	move: 'idle',
	phase: 'recovery',
	progress: 0,
	flags: 0,
	emote: null,
	emoteT: 0,
};

// --- Poise + hit-reaction (ADR 0017 §2/§3) ----------------------------------
//
// Poise is an accumulating pool: a hit always deals HP damage but only Staggers on a
// pool break, and the pool regenerates under no pressure. Off-wire — the server tracks
// it, the client never sees it.

// While an attacker is in its own wind-up, a hit chips its Poise but cannot break it,
// so a jab can't interrupt a committed heavy swing (ADR 0017 §3).
export function superArmorActive(e: Entity): boolean {
	return swingPhase(e.attackT) === 'windup';
}

// Apply poise damage, returning the new pool and whether the hit BROKE it. A break
// refills the pool (the Stagger is the cost). Super-armor suppresses a break, clamping
// the chipped pool at 0 so the next hit out of wind-up breaks immediately.
export function applyPoiseDamage(
	e: Entity,
	poiseDamage: number,
): { poise: number; broke: boolean } {
	const max = e.poiseMax ?? COMBAT.poise.max;
	const cur = e.poise ?? max;
	if (superArmorActive(e))
		return { poise: Math.max(0, cur - poiseDamage), broke: false };
	const next = cur - poiseDamage;
	if (next <= 0) return { poise: max, broke: true };
	return { poise: next, broke: false };
}

// Always-on regen is the MVP of "regenerates under no pressure": a hit depletes far
// faster than this refills, preserving the chip-then-break rhythm (ADR 0017 §3).
export function regenPoise(e: Entity, dt: number): number {
	const max = e.poiseMax ?? COMBAT.poise.max;
	return Math.min(max, (e.poise ?? max) + COMBAT.poise.regen * dt);
}

// The action-state to broadcast for an entity, derived from its swing timer. Only
// Avatars run the phase machine so far; the snapshot builder replicates IDLE_ACTION
// for Monsters (their offense rework is a later slice).
export function actionStateOf(e: Entity): ActionState {
	const flags = actionFlags(e);
	// The active body emote rides every action-state so an observer renders the same
	// Pose the owner predicts (ADR 0020 §9).
	const emote = e.emoteId ?? null;
	const emoteT = e.emoteT ?? 0;
	// A Dodge takes precedence over the swing for the `move` slot — you cannot do both
	// at once — reusing the AttackPhase names.
	const dPhase = dodgePhase(e.dodgeT ?? 0);
	if (dPhase)
		return {
			move: 'dodge',
			phase: dPhase,
			progress: dodgeProgress(e.dodgeT ?? 0),
			flags,
			emote,
			emoteT,
		};
	const phase = swingPhase(e.attackT);
	if (!phase) return { ...IDLE_ACTION, flags, emote, emoteT };
	return {
		move: 'basic',
		phase,
		progress: swingProgress(e.attackT),
		flags,
		emote,
		emoteT,
	};
}

// Guard is one held scalar `guardT` (seconds held, counting UP). With Parry removed
// (ADR 0024) the held duration no longer gates anything — any raised Guard is a Block.
export function guardRaised(guardT: number): boolean {
	return guardT > 0;
}

// A hit from behind (the defender facing away) ignores Guard, rewarding positioning
// without precise directional block inputs. An attacker sharing the defender's column
// is treated as frontal (ambiguous → the defender's favour). (ADR 0017 §5)
export function facingToward(defender: Entity, attackerX: number): boolean {
	const side = Math.sign(attackerX - defender.x);
	return side === 0 || side === defender.facing;
}

// The outcome of resolving a frontal hit against a (possibly) guarding defender:
//   - 'none'  : no Guard (or a rear hit) — full damage.
//   - 'block' : a raised frontal Guard — chip `hpDamage`, drain Poise, and on a pool
//               break flag a guard-break Stagger.
// One gate so server and prediction can't disagree (ADR 0017 §5).
export interface GuardOutcome {
	result: 'none' | 'block';
	hpDamage: number; // HP the defender takes (chip block / full none)
	defenderPoise: number; // the defender's new Poise pool
	guardBroke: boolean; // a Block emptied the pool → guard-break Stagger of the defender
}
export function resolveGuard(
	defender: Entity,
	attackerX: number,
	hpDamage: number,
	cfg: typeof COMBAT.guard = COMBAT.guard,
): GuardOutcome {
	const guardT = defender.guardT ?? 0;
	const pool = defender.poise ?? COMBAT.poise.max;
	const none: GuardOutcome = {
		result: 'none',
		hpDamage,
		defenderPoise: pool,
		guardBroke: false,
	};
	if (!guardRaised(guardT) || !facingToward(defender, attackerX)) return none;
	// Reuse applyPoiseDamage so a guard-break uses the same accumulating-pool break the
	// rest of combat does — a blocked flurry empties the pool and Staggers a turtle.
	const { poise, broke } = applyPoiseDamage(defender, cfg.blockPoise);
	return {
		result: 'block',
		hpDamage: Math.ceil(hpDamage * cfg.blockChip),
		defenderPoise: poise,
		guardBroke: broke,
	};
}

// Just past the defender's leading edge at mid-height, so the brace reads as held up
// in front.
export function guardPoseCell(e: Entity): { x: number; y: number } {
	return { x: e.facing === 1 ? e.x + BOX.w : e.x - 1, y: e.y + 1 };
}

export function guardPoseGlyph(): string {
	return '┃';
}

// --- Slash-arc + per-phase pose realization data (ADR 0017 §13a/b) ----------
// Pure geometry the client blits with its own colour, kept here so the pose↔phase
// mapping is deterministic and unit-tested rather than buried in the renderer.

// The weapon-tip glyph oriented for `facing`: cocked-back on wind-up, level on active,
// trailing-low on recovery.
export function swingPoseGlyph(phase: AttackPhase, facing: Facing): string {
	const right = phase === 'windup' ? '╲' : phase === 'active' ? '─' : '╱';
	if (facing === 1) return right;
	return right === '╲' ? '╱' : right === '╱' ? '╲' : right;
}

// Just past the leading edge, raised on wind-up, mid on active, low on recovery — so
// the accent reads as the weapon arcing down through the swing.
export function swingPoseCell(
	e: Entity,
	phase: AttackPhase,
): { x: number; y: number } {
	const lead = e.facing === 1 ? e.x + BOX.w : e.x - 1;
	const row =
		phase === 'windup' ? e.y : phase === 'active' ? e.y + 1 : e.y + BOX.h - 1;
	return { x: lead, y: row };
}

// (The Dodge after-image is a self-contained client effect on the render clock — see
// client `dodge-echo.ts`, ADR 0017 §13e — so it needs no pure pose helper here.)

// The unarmed swing telegraph: the shared tip glyph, plus a slash-arc sweep glyph
// during the active phase. Only ever drawn for an unarmed (Monster) swing — a weaponed
// swing is its composited WeaponSprite instead (ADR 0024). Null when `move` isn't a
// basic swing.
export interface SwingPose {
	glyph: string; // swing-tip telegraph, already oriented for facing
	arc: string | null; // slash-arc sweep glyph (active phase only), else null
}
export function swingPose(
	move: MoveId,
	phase: AttackPhase,
	facing: Facing,
): SwingPose | null {
	if (move !== 'basic') return null;
	const glyph = facing === 1 ? '╱' : '╲';
	const arc = phase === 'active' ? (facing === 1 ? '╱' : '╲') : null;
	return { glyph, arc };
}

// The WeaponSprite frame-set an Avatar shows this frame: `idle` for any non-swing,
// else the swing phase's own frame id. Shared so owner-prediction and every observer
// agree frame-for-frame; the `active` phase is an ordered sweep, indexed by
// `sweepIndex` (ADR 0018 §4).
export function weaponFrame(
	move: MoveId,
	phase: AttackPhase | null,
): WeaponFrameId {
	if (move !== 'basic' || phase === null) return 'idle';
	return phase;
}

// The sweep is partitioned into `len` equal slices, clamped to [0, len-1] so a progress
// at or past the active-phase boundary still resolves to a real frame (ADR 0018 §4).
export function sweepIndex(progress: number, len: number): number {
	if (len <= 1) return 0;
	const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
	return Math.min(len - 1, Math.floor(p * len));
}

// One cell of a blade-edge arc: a curve glyph at an offset (dx,dy) FROM THE GRIP.
export interface ArcCell {
	dx: number;
	dy: number;
	glyph: string;
}

// The blade tip pivots around the grip from up-forward to down-forward — a
// quarter-circle on the leading side. Radius and span are fixed for every weapon; heft
// comes from phase durations instead (ADR 0018 §4).
const ARC_RADIUS = 3;
const ARC_FROM = -Math.PI / 3; // up-forward at progress 0 (~-60°)
const ARC_TO = Math.PI / 4; // down-forward at progress 1 (~+45°)
const ARC_SMEAR = 3; // current tip + trailing samples
const ARC_STEP = 0.16; // progress between trailing samples

function arcGlyph(dy: number, facing: Facing): string {
	if (dy < 0) return facing === 1 ? '╲' : '╱';
	if (dy > 0) return facing === 1 ? '╱' : '╲';
	return '─';
}

// A short fading smear tracing the blade tip through its arc: the current tip plus a
// couple of trailing samples (newest first). Call only during the active phase.
// Duplicate cells (rounding collisions between samples) are dropped, keeping the
// newest position (ADR 0018 §5).
export function bladeEdgeArc(progress: number, facing: Facing): ArcCell[] {
	const head = progress < 0 ? 0 : progress > 1 ? 1 : progress;
	const cells: ArcCell[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < ARC_SMEAR; i++) {
		const s = head - i * ARC_STEP;
		if (s < 0) break;
		const theta = ARC_FROM + (ARC_TO - ARC_FROM) * s;
		const dx = Math.round(ARC_RADIUS * Math.cos(theta)) * facing;
		const dy = Math.round(ARC_RADIUS * Math.sin(theta));
		const key = `${dx},${dy}`;
		if (seen.has(key)) continue;
		seen.add(key);
		cells.push({ dx, dy, glyph: arcGlyph(dy, facing) });
	}
	return cells;
}

// --- CombatEvent: the semantic fact of a combat interaction (ADR 0019) ------
//
// Distinct from an Effect (the presentation descriptor). Never rides the wire — the
// server projects it to Effects via `effectsOf` before building each snapshot.
export type CombatEventKind = 'hit' | 'break' | 'death' | 'swat';

interface CombatEventBase {
	targetId: number; // an Entity for hit/break/death, a Projectile for swat
	x: number;
	y: number;
	intensity: number; // damage dealt; drives particle count / sound volume
}

// Discriminated on `kind` so each kind carries only the fields it can meaningfully hold
// — illegal combinations (a tinted `hit`, a sourced `death`, a radial `swat`) are
// unrepresentable:
//   - `source` rides a predicted `hit` alone — it keys originator-suppression (ADR
//     0013 §3); the "big moments" (break/death/swat) are source-less and reach everyone.
//   - `tint` rides a `death` alone — the dead entity's body colour, recoloured onto the
//     gore burst (#139).
//   - `dir` is typed to the biases each kind can resolve to: `death` is always radial
//     (0), `swat` never is (±1), only `hit` spans both.
export type CombatEvent =
	| (CombatEventBase & { kind: 'hit'; dir: -1 | 0 | 1; source?: number })
	| (CombatEventBase & { kind: 'break'; dir: -1 | 0 | 1 })
	| (CombatEventBase & { kind: 'swat'; dir: Facing })
	| (CombatEventBase & { kind: 'death'; dir: 0; tint?: Tint });

// The shared constructor both server resolution and client prediction build their
// entity-targeted events with, so the resolved fact is computed in one place. Builds
// the entity-centred kinds only (`death`/`swat` have their own constructors). `source`
// is honoured for a `hit` alone — dropped on a break, which reaches everyone (ADR 0013 §3).
export function combatEventAt(
	kind: 'hit' | 'break',
	target: Entity,
	dir: -1 | 0 | 1,
	intensity: number,
	source?: number,
): CombatEvent {
	const e = {
		kind,
		targetId: target.id,
		x: target.x + BOX.w / 2,
		y: target.y + BOX.h / 2,
		dir,
		intensity,
	} as CombatEvent;
	if (e.kind === 'hit' && source !== undefined) e.source = source;
	return e;
}

// A radial, high-intensity burst tinted to the entity's body colour, so a kill sprays
// entity-coloured gore in every direction. Source-less — it reaches everyone in range,
// the killer included (ADR 0013 §1 / #139).
export function deathEvent(e: Entity): CombatEvent {
	return {
		kind: 'death',
		targetId: e.id,
		x: e.x + BOX.w / 2,
		y: e.y + BOX.h / 2,
		dir: 0,
		intensity: COMBAT.deathBurstIntensity,
		tint: entityTint(e),
	};
}

// A Player's melee frame shattered a hostile Projectile. Resolves against the shot, so
// it carries the SHOT's own position and id (not an entity-box centre). `dir` is the
// clink bias, back along the swat. Source-less (ADR 0017 §8).
export function swatEvent(pr: Projectile, dir: Facing): CombatEvent {
	return {
		kind: 'swat',
		targetId: pr.id,
		x: pr.x,
		y: pr.y,
		dir,
		intensity: pr.damage,
	};
}

// The single home for the semantic→presentational mapping (hit→blood, break→impact,
// death→gore, swat→impact). A lethal blow voices `death` alone, not death+hit — the
// suppression is in choosing the kind (ADR 0014 §2). Returns an array so a future kind
// can fan out to several Effects.
export function effectsOf(e: CombatEvent): Effect[] {
	switch (e.kind) {
		case 'hit': {
			const fx: Effect = {
				kind: 'blood',
				x: e.x,
				y: e.y,
				intensity: e.intensity,
				dir: e.dir,
			};
			if (e.source !== undefined) fx.source = e.source;
			return [fx];
		}
		case 'break':
			// Heavier + sharper than a chip of the same damage: the poise.max bump makes a
			// Stagger read visibly bigger (ADR 0017 §13d).
			return [
				{
					kind: 'impact',
					x: e.x,
					y: e.y,
					intensity: e.intensity + COMBAT.poise.max,
					dir: e.dir,
				},
			];
		case 'death': {
			const fx: Effect = {
				kind: 'gore',
				x: e.x,
				y: e.y,
				intensity: e.intensity,
				dir: e.dir,
			};
			if (e.tint !== undefined) fx.tint = e.tint;
			return [fx];
		}
		case 'swat':
			// A light clink, NOT a Poise break — so its impact reads at the shot's own damage
			// with NO poise.max bump (the only `impact` projection that doesn't) (ADR 0017 §8).
			return [
				{ kind: 'impact', x: e.x, y: e.y, intensity: e.intensity, dir: e.dir },
			];
	}
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

// The blood Effect a landed hit on a Monster emits, shared so `stepZone` and the
// client's outgoing-hit prediction produce identical Effects. `source` keys
// originator-suppression; the client predictor omits it (ADR 0013).
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

// The impact Effect a Poise-break emits: the wire signal the client realizes into the
// spark burst and keys hitstop + camera-kick off. Source-less — delivered to everyone
// including the attacker, who needs it for the camera-kick (the client predicts only
// chip blood, so the spark never double-renders) (ADR 0017 §13d).
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

// Server-sourced only (never predicted) and source-less, so the per-recipient snapshot
// filter delivers it to everyone including the victim, in sync with the hurt-flash. `dir`
// 0 = radial when the source direction is ambiguous (ADR 0013, #132).
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

// Does this swing's `hitbox` NEWLY strike `target` — overlapping it and not yet in the
// per-swing `swingHits` registry? One shared gate for the server's hit loop and the
// client's prediction, so they can't diverge on who a swing hit. A null hitbox never
// strikes. The caller folds the struck id into its registry (ADR 0017 §2).
export function swingHitsTarget(
	hitbox: Box | null,
	swingHits: ReadonlySet<number>,
	target: Entity,
): boolean {
	return (
		hitbox !== null &&
		!swingHits.has(target.id) &&
		aabbOverlap(hitbox, entityBox(target))
	);
}

// The optimistic `hit` events the local Avatar's live swing produces this tick, gated
// by the same `swingHits` registry the server uses. The caller projects them through
// `effectsOf` for zero-latency blood. No rollback on mispredict: a stray splat on a
// swing the server scores as a miss is acceptable (ADR 0019).
export function predictHits(
	hitbox: Box | null,
	attackerFacing: Facing,
	damage: number,
	swingHits: ReadonlySet<number>,
	monsters: Entity[],
): CombatEvent[] {
	if (!hitbox) return [];
	const events: CombatEvent[] = [];
	for (const m of monsters)
		if (swingHitsTarget(hitbox, swingHits, m))
			events.push(combatEventAt('hit', m, attackerFacing, damage));
	return events;
}

// The one shared resolution of an Avatar's combat Intent for a tick, run by both the
// authoritative server step and the client's optimistic prediction so the two can't
// diverge. Owns the per-tick decay of `attackT` and every skill cooldown (the caller
// decays `hurtT` separately — that stays with vitals).
//
// `dt` is in SECONDS, like stepZone and the client's clamped `dtSec`.
export function resolveCombat(
	avatar: Entity,
	cooldowns: Record<string, number>,
	level: number,
	cls: PlayerClass,
	// `dodge` is the caller's ALREADY-GATED decision: the impulse site runs the full
	// `canStartDodge` before the hop ungrounds the body, so this only re-checks the
	// tick-stable `dodgeReady` timing and never re-derives movement post-physics.
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
	dodgeT: number; // caller folds back onto the Entity; on `dodgeStarted` applies the hop impulse
	dodgeCdT: number; // the re-dodge lockout spam-gate; outlives `dodgeT` by `cooldown`
	dodgeStarted: boolean;
	cooldowns: Record<string, number>;
	skillFired?: Skill;
	// True the tick a fresh swing begins: the caller clears the per-swing hit list so
	// the new swing can connect again (ADR 0017 §2).
	swingStarted: boolean;
	guardT: number; // seconds the Guard has been held this raise; 0 when not guarding
} {
	const attackT = Math.max(0, avatar.attackT - dt);
	const decayed: Record<string, number> = {};
	for (const [id, cd] of Object.entries(cooldowns))
		decayed[id] = Math.max(0, cd - dt);

	// The Dodge resolves first: it both gates and is gated by the swing. The hop impulse
	// is applied by the caller (which owns the momentum body, ADR 0001) — here we only
	// track its timing. The i-frame timer only loads once the verb is unlocked, so a
	// stale/forged intent can't buy a below-L4 Avatar i-frames (ADR 0024 §5).
	const dodgeStarted =
		(intent.dodge ?? false) &&
		dodgeReady(avatar) &&
		capabilityUnlocked('dodge', level);
	const dodgeT = dodgeStarted
		? DODGE_TOTAL
		: Math.max(0, (avatar.dodgeT ?? 0) - dt);
	const dodgeCdT = dodgeStarted
		? DODGE_LOCKOUT
		: Math.max(0, (avatar.dodgeCdT ?? 0) - dt);

	// Swing, Dodge, and Guard are mutually exclusive: a swing can't start mid-Dodge (even
	// the tick it begins) or while guarding, and the Guard can't rise mid-swing, mid-Dodge,
	// or while Staggered (ADR 0017 §5). A fresh swing only starts from idle, so its start
	// tick is in wind-up and the hitbox is not yet live. Block only rises once the verb is
	// unlocked, so a level-1 Avatar cannot brace (ADR 0024 §5).
	const guarding = intent.guard === true && capabilityUnlocked('block', level);
	const starting =
		(intent.attack ?? false) && attackT <= 0 && dodgeT <= 0 && !guarding;
	const nextAttackT = starting ? SWING_TOTAL : attackT;
	// Clamped so an indefinite hold doesn't grow `guardT` unbounded; any other tick
	// resets it to 0 (a release drops the brace).
	const canGuard =
		guarding && nextAttackT <= 0 && dodgeT <= 0 && (avatar.stunT ?? 0) <= 0;
	const guardT = canGuard
		? Math.min((avatar.guardT ?? 0) + dt, COMBAT.guard.heldClamp)
		: 0;
	let hitbox: Box | null = meleeActive(nextAttackT)
		? meleeHitbox(avatar)
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

// Apply player-faction Strikes to the Monsters they newly strike. Guardless by design:
// Monsters have no Guard hub (that is `resolveHitsOnAvatars`), so this is poise / break
// / death only.
//
// `swingHits` is the per-swing dedup ledger (`attackerId → hit victim ids`), kept at the
// resolution site rather than on the Strike: a melee hitbox is live for multiple ticks
// and must hit each victim once per swing — a property of the attack instance, not the
// Strike. The first Strike to land on a Monster deals the hit (ADR 0022).
export function resolveHitsOnMonsters(
	monsters: Entity[],
	strikes: Strike[],
	swingHits: Map<number, Set<number>>,
): { monsters: Entity[]; effects: Effect[] } {
	const effects: Effect[] = [];
	const resolved = monsters.map((m0) => {
		let m = m0;
		for (const s of strikes) {
			// Opposing-Faction only, so PvE holds by construction (ADR 0022).
			if (s.faction !== 'players') continue;
			const hits = swingHits.get(s.attackerId) ?? new Set<number>();
			if (!swingHitsTarget(s.hitbox, hits, m)) continue;
			hits.add(m.id);
			swingHits.set(s.attackerId, hits);
			const contributors = m.contributors?.includes(s.attackerId)
				? m.contributors
				: [...(m.contributors ?? []), s.attackerId];
			const { poise, broke } = applyPoiseDamage(m, s.poiseDamage);
			// Reset the regen-delay so a sustained flurry keeps the pool from healing between
			// swings (ADR 0017 §3).
			m = {
				...m,
				hp: m.hp - s.damage,
				poise,
				poiseT: COMBAT.poise.regenDelay,
				contributors,
			};
			if (broke) {
				// Poise break → Stagger: knockback + upward pop + Hitstun (no weapon reshapes the
				// throw, ADR 0024). Source-less, so the impact reaches everyone including the
				// attacker, who needs it for the camera-kick.
				m = applyImpulse(m, COMBAT.knockback * s.facing, -COMBAT.knockbackUp);
				m = { ...m, stunT: COMBAT.hitstun };
				effects.push(
					...effectsOf(combatEventAt('break', m, s.facing, s.damage)),
				);
			} else {
				// Chip: `source` suppresses the blood back to the attacker, who already predicted
				// it through the same projection (ADR 0013 §3).
				effects.push(
					...effectsOf(
						combatEventAt('hit', m, s.facing, s.damage, s.attackerId),
					),
				);
			}
			// First Strike to land deals the hit; a second attacker re-hits only via a new
			// swing (its own ledger).
			break;
		}
		return m;
	});
	return { monsters: resolved, effects };
}

export interface AvatarCombatCtx {
	level: number;
	cls: PlayerClass;
	weapon: Weapon;
	dt: number; // SECONDS, like resolveCombat
}

// The one shared per-Avatar combat fold: runs the `resolveCombat` gate and folds its
// delta back onto the Avatar, returning a projected `Strike` for the caller to apply.
// Both authority paths run this so they can't diverge — the server maps it over its
// Avatar set, the client calls it for its own Avatar in prediction. It owns the fold
// only: it never applies hits to Monsters (that stays on the asymmetric
// `resolveHitsOnMonsters` / `predictHits` paths) and never touches `hurtT`/emote/log,
// which stay with each caller's vitals advance (ADR 0022).
export function stepAvatarCombat(
	avatar: Entity,
	intent: {
		attack?: boolean;
		skill?: number;
		dodge?: boolean;
		guard?: boolean;
	},
	ctx: AvatarCombatCtx,
): {
	avatar: Entity;
	strikes: Strike[];
} {
	const r = resolveCombat(
		avatar,
		avatar.skillCooldowns ?? {},
		ctx.level,
		ctx.cls,
		intent,
		ctx.dt,
		ctx.weapon,
	);
	const folded: Entity = {
		...avatar,
		attackT: r.attackT,
		dodgeT: r.dodgeT,
		dodgeCdT: r.dodgeCdT,
		guardT: r.guardT,
		skillCooldowns: r.cooldowns,
		// A fresh swing clears the per-swing hit list so it can connect again; an in-flight
		// swing keeps its list so it lands on each target only once (ADR 0017 §2).
		swingHits: r.swingStarted ? [] : (avatar.swingHits ?? []),
	};
	// A live hitbox this tick becomes one player-faction melee Strike; no live box → no
	// Strike. The per-swing dedup ledger is not on the Strike — it lives at the resolution
	// site (ADR 0022).
	const strikes: Strike[] =
		r.hitbox !== null
			? [
					{
						attackerId: folded.id,
						attackerKind: 'avatar',
						hitbox: r.hitbox,
						damage: r.damage,
						poiseDamage: COMBAT.poiseDamage,
						facing: folded.facing,
						faction: 'players',
					},
				]
			: [];
	return { avatar: folded, strikes };
}
