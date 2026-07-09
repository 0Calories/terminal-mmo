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
import { spriteMetaFor, type WeaponFrameId } from './sprites';
import type {
	ActionState,
	AttackPhase,
	Box,
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

export function entityTint(e: Entity): Tint {
	const quad =
		e.cosmetics !== undefined
			? (HUES[e.cosmetics.hue] ?? HUES[0])
			: (BODY_PALETTE[spriteMetaFor(e.type).defaultKey] ?? BODY_PALETTE.p);
	return { r: quad[0], g: quad[1], b: quad[2] };
}

export function entityBox(e: Entity): Box {
	return { x: e.x, y: e.y, w: BOX.w, h: BOX.h };
}

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

export function meleeActive(attackT: number): boolean {
	return swingPhase(attackT) === 'active';
}

export interface MeleeProfile {
	damage: number;
	poise: number;
	range: number;
	aggro: number;
	deadzone: number;
	commitCd: number;
}

export function meleeProfileOf(type: EntityType): MeleeProfile | null {
	if (type === 'chaser')
		return {
			damage: MONSTER.meleeDamage,
			poise: COMBAT.poiseDamage,
			range: MONSTER.meleeRange,
			aggro: MONSTER.chaserAggro,
			deadzone: MONSTER.chaserDeadzone,
			commitCd: 0,
		};
	if (type === 'brute')
		return {
			damage: BRUTE.meleeDamage,
			poise: BRUTE.meleePoise,
			range: BRUTE.meleeRange,
			aggro: BRUTE.aggro,
			deadzone: BRUTE.deadzone,
			commitCd: BRUTE.commitCooldown,
		};
	return null;
}

export const DODGE_TOTAL = COMBAT.dodge.active + COMBAT.dodge.recovery;

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

export function dodgeInvulnerable(e: Entity): boolean {
	return dodgePhase(e.dodgeT ?? 0) === 'active';
}

export function dodgeReady(e: Entity): boolean {
	return (
		(e.dodgeCdT ?? 0) <= 0 &&
		(e.dodgeT ?? 0) <= 0 &&
		e.attackT <= 0 &&
		(e.stunT ?? 0) <= 0
	);
}

// Evaluate BEFORE the hop ungrounds the body — the movement conditions can't be re-derived post-physics.
export function canStartDodge(e: Entity, moveX: number): boolean {
	return dodgeReady(e) && e.onGround && moveX !== 0;
}

export function avatarHittable(a: Entity): boolean {
	return a.hurtT <= 0 && !dodgeInvulnerable(a);
}

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

export function superArmorActive(e: Entity): boolean {
	return swingPhase(e.attackT) === 'windup';
}

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

export function regenPoise(e: Entity, dt: number): number {
	const max = e.poiseMax ?? COMBAT.poise.max;
	return Math.min(max, (e.poise ?? max) + COMBAT.poise.regen * dt);
}

export function actionStateOf(e: Entity): ActionState {
	const flags = actionFlags(e);
	const emote = e.emoteId ?? null;
	const emoteT = e.emoteT ?? 0;
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

export function guardRaised(guardT: number): boolean {
	return guardT > 0;
}

// A hit from behind (defender facing away) ignores Guard; a same-column attacker counts as frontal.
export function facingToward(defender: Entity, attackerX: number): boolean {
	const side = Math.sign(attackerX - defender.x);
	return side === 0 || side === defender.facing;
}

export interface GuardOutcome {
	result: 'none' | 'block';
	hpDamage: number;
	defenderPoise: number;
	guardBroke: boolean;
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
	const { poise, broke } = applyPoiseDamage(defender, cfg.blockPoise);
	return {
		result: 'block',
		hpDamage: Math.ceil(hpDamage * cfg.blockChip),
		defenderPoise: poise,
		guardBroke: broke,
	};
}

export function guardPoseCell(e: Entity): { x: number; y: number } {
	return { x: e.facing === 1 ? e.x + BOX.w : e.x - 1, y: e.y + 1 };
}

export function guardPoseGlyph(): string {
	return '┃';
}

export function swingPoseGlyph(phase: AttackPhase, facing: Facing): string {
	const right = phase === 'windup' ? '╲' : phase === 'active' ? '─' : '╱';
	if (facing === 1) return right;
	return right === '╲' ? '╱' : right === '╱' ? '╲' : right;
}

export function swingPoseCell(
	e: Entity,
	phase: AttackPhase,
): { x: number; y: number } {
	const lead = e.facing === 1 ? e.x + BOX.w : e.x - 1;
	const row =
		phase === 'windup' ? e.y : phase === 'active' ? e.y + 1 : e.y + BOX.h - 1;
	return { x: lead, y: row };
}

export interface SwingPose {
	glyph: string;
	arc: string | null;
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

export function weaponFrame(
	move: MoveId,
	phase: AttackPhase | null,
): WeaponFrameId {
	if (move !== 'basic' || phase === null) return 'idle';
	return phase;
}

export function sweepIndex(progress: number, len: number): number {
	if (len <= 1) return 0;
	const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
	return Math.min(len - 1, Math.floor(p * len));
}

export interface ArcCell {
	dx: number;
	dy: number;
	glyph: string;
}

const ARC_RADIUS = 3;
const ARC_FROM = -Math.PI / 3;
const ARC_TO = Math.PI / 4;
const ARC_SMEAR = 3;
const ARC_STEP = 0.16;

function arcGlyph(dy: number, facing: Facing): string {
	if (dy < 0) return facing === 1 ? '╲' : '╱';
	if (dy > 0) return facing === 1 ? '╱' : '╲';
	return '─';
}

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

export type CombatEventKind = 'hit' | 'break' | 'death' | 'swat';

interface CombatEventBase {
	targetId: number;
	x: number;
	y: number;
	intensity: number;
}

export type CombatEvent =
	| (CombatEventBase & { kind: 'hit'; dir: -1 | 0 | 1; source?: number })
	| (CombatEventBase & { kind: 'break'; dir: -1 | 0 | 1 })
	| (CombatEventBase & { kind: 'swat'; dir: Facing })
	| (CombatEventBase & { kind: 'death'; dir: 0; tint?: Tint });

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

export function resolveCombat(
	avatar: Entity,
	cooldowns: Record<string, number>,
	level: number,
	cls: PlayerClass,
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
	dodgeT: number;
	dodgeCdT: number;
	dodgeStarted: boolean;
	cooldowns: Record<string, number>;
	skillFired?: Skill;
	swingStarted: boolean;
	guardT: number;
} {
	const attackT = Math.max(0, avatar.attackT - dt);
	const decayed: Record<string, number> = {};
	for (const [id, cd] of Object.entries(cooldowns))
		decayed[id] = Math.max(0, cd - dt);

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

	const guarding = intent.guard === true && capabilityUnlocked('block', level);
	const starting =
		(intent.attack ?? false) && attackT <= 0 && dodgeT <= 0 && !guarding;
	const nextAttackT = starting ? SWING_TOTAL : attackT;
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

export function resolveHitsOnMonsters(
	monsters: Entity[],
	strikes: Strike[],
	swingHits: Map<number, Set<number>>,
): { monsters: Entity[]; events: CombatEvent[] } {
	const events: CombatEvent[] = [];
	const resolved = monsters.map((m0) => {
		let m = m0;
		for (const s of strikes) {
			if (s.faction !== 'players') continue;
			const hits = swingHits.get(s.attackerId) ?? new Set<number>();
			if (!swingHitsTarget(s.hitbox, hits, m)) continue;
			hits.add(m.id);
			swingHits.set(s.attackerId, hits);
			const contributors = m.contributors?.includes(s.attackerId)
				? m.contributors
				: [...(m.contributors ?? []), s.attackerId];
			const { poise, broke } = applyPoiseDamage(m, s.poiseDamage);
			m = {
				...m,
				hp: m.hp - s.damage,
				poise,
				poiseT: COMBAT.poise.regenDelay,
				contributors,
			};
			if (broke) {
				m = applyImpulse(m, COMBAT.knockback * s.facing, -COMBAT.knockbackUp);
				m = { ...m, stunT: COMBAT.hitstun };
				events.push(combatEventAt('break', m, s.facing, s.damage));
			} else {
				events.push(combatEventAt('hit', m, s.facing, s.damage, s.attackerId));
			}
			break;
		}
		return m;
	});
	return { monsters: resolved, events };
}

export interface AvatarCombatCtx {
	level: number;
	cls: PlayerClass;
	weapon: Weapon;
	dt: number;
}

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
		swingHits: r.swingStarted ? [] : (avatar.swingHits ?? []),
	};
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
