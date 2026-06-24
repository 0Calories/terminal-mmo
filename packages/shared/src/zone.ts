// The server-authoritative Zone simulation and the client-local Avatar
// prediction step (ADR 0006). Splitting the old single-Avatar `step` into these
// two pure functions is the M2 refactor: the server advances Monsters /
// Projectiles and owns every consequence (Avatar HP, death/respawn, loot, XP,
// Gold) for N reported Avatars; the client predicts only its own Avatar's
// platformer physics. Both live here, framework-free and deterministic, so the
// two sides can never diverge.

import {
	aabbOverlap,
	actionFlags,
	actionStateOf,
	applyPoiseDamage,
	avatarHittable,
	bloodEffect,
	deathGoreEffect,
	entityBox,
	hurtBloodEffect,
	IDLE_ACTION,
	impactEffect,
	meleeActive,
	meleeHitbox,
	parryEffect,
	regenPoise,
	resolveCombat,
	resolveGuard,
	SWING_TOTAL,
	swingPhase,
} from './combat';
import {
	BOX,
	COMBAT,
	MONSTER,
	PHYS,
	RESPAWN,
	SHOOTER,
	SPAWN,
	XP_PER_KILL,
} from './constants';
import { DEFAULT_COSMETICS } from './cosmetics';
import { rollItem } from './loot';
import { movesetUnlocked } from './moveset';
import { applyImpulse, stepEntity } from './physics';
import { spawnAvatar } from './player';
import { applyXp, maxHpForLevel } from './progression';
import { projectileBox, spawnProjectile, stepProjectile } from './projectile';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from './protocol';
import type { PlayerClass } from './skills';
import { isSolid } from './terrain';
import type {
	Box,
	Control,
	Cosmetics,
	Effect,
	Entity,
	Facing,
	Item,
	PendingRespawn,
	PlayerProgress,
	Projectile,
	Terrain,
} from './types';
import { DEFAULT_WEAPON, weaponById } from './weapons';
import { spawnMonster, type Zone } from './world';

// Server-authoritative per-Avatar state. Position/facing are client-reported
// each tick (ADR 0001); HP / progress / inventory / loot rng are server-owned.
export interface ServerAvatar {
	sessionId: number;
	handle: string; // ephemeral nameplate handle from the handshake
	cosmetics: Cosmetics; // chosen hue / hat / nameplate colour (#35), echoed in snapshots
	avatar: Entity;
	progress: PlayerProgress;
	inventory: Item[];
	log: string[];
	nextId: number; // id source for this Avatar's looted Items
	rngState: number;
	class?: PlayerClass; // absent == 'warrior'
	skillCooldowns?: Record<string, number>;
}

export interface ZoneState {
	zone: Zone;
	avatars: ServerAvatar[];
	tick: number;
	// Sessions whose Avatar hit 0 HP this tick (transient stepZone output). The
	// Zone respawns them in place at the safe point; the world layer uses this to
	// relocate a forgiving death to Town (#33).
	deaths?: number[];
	// Combat Effects emitted this tick (transient stepZone output, ADR 0013): one
	// blood burst per damage site. The client realizes them into Particles; the
	// offline loop reads them straight off the step result, the server batches them
	// into each recipient's snapshot.
	effects?: Effect[];
}

// One tick of client->server input: the reported Avatar kinematics plus the
// combat intents the server resolves authoritatively.
export interface AvatarIntent {
	sessionId: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	// External-impulse channel of the reported momentum body (ADR 0017): carried so a
	// client-applied Dodge/Knockback hop persists server-side across ticks (the server
	// trusts client kinematics and never re-simulates position). Absent == unchanged.
	ivx?: number;
	facing: Facing;
	onGround: boolean;
	attack: boolean;
	guard?: boolean; // raise the Guard this tick (ADR 0017 §5); absent == false
	interact?: boolean; // request a Portal transition; resolved by the world layer
	dodge?: boolean; // start an i-frame Dodge hop this tick (ADR 0017 §5)
	skill?: number;
	// Input staleness in ms (ADR 0017 §11): how late this input reached the server,
	// derived from its client timestamp by the impure server layer. Widens the Parry
	// window (clamped to COMBAT.guard.lagComp) so a Parry timed right on the Player's
	// delayed screen still resolves. Absent / 0 == no lag (offline, single clock).
	lagMs?: number;
}

/**
 * Thin client-local prediction of the own Avatar: the shared platformer physics
 * plus local timer decay, so movement and the swing telegraph feel instant
 * between ~20 Hz snapshots. The server still owns the authoritative result.
 * `attackT` decay now lives in `resolveCombat` (the shared combat gate the
 * caller runs each frame); this only advances physics and decays `hurtT`.
 */
export function clientStepAvatar(
	t: Terrain,
	avatar: Entity,
	ctl: Control,
	dtMs: number,
): Entity {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const e = stepEntity(t, avatar, ctl, dt).e;
	e.hurtT = Math.max(0, e.hurtT - dt);
	return e;
}

// Server-only adapter over the shared `resolveCombat` gate (combat.ts): the
// melee/skill hitbox an Avatar projects this tick, if any, plus the folded
// ServerAvatar (attack cooldown / skill cooldowns applied, hurtT decayed, log
// appended). A reported tick trusts the client kinematics and runs the live
// combat Intent; a missed report holds position and runs an empty Intent so the
// same decay still happens (attackT AND skill cooldowns), projecting no hitbox.
function resolveAvatarIntent(
	src: ServerAvatar,
	intent: AvatarIntent | undefined,
	dt: number,
): { sa: ServerAvatar; hb: Box | null; damage: number } {
	// Trust the client's reported kinematics; keep the server-owned vitals. With
	// no report this tick, hold the prior kinematics in place.
	const avatar: Entity = intent
		? {
				...src.avatar,
				x: intent.x,
				y: intent.y,
				vx: intent.vx,
				vy: intent.vy,
				// Carry the reported impulse channel so a Dodge/Knockback hop the client
				// integrated persists into this tick's authoritative avatar (absent == keep
				// the prior residual).
				ivx: intent.ivx ?? src.avatar.ivx,
				facing: intent.facing,
				onGround: intent.onGround,
			}
		: { ...src.avatar };

	const log = src.log.slice(-5);
	// The equipped Weapon drives the swing's phase durations, damage, and arc through
	// the shared gate (ADR 0017 §14) — no special-casing per weapon, just its stat
	// block. Absent == the default sword.
	const r = resolveCombat(
		avatar,
		src.skillCooldowns ?? {},
		src.progress.level,
		src.class ?? 'warrior',
		// `dodge` is the client's already-gated decision (grounded + moving checked at the
		// impulse site before the hop ungrounds the body, ADR 0017 §5 / ADR 0001); the
		// server only re-enforces the tick-stable timing (cooldown etc.) in resolveCombat.
		// `guard` raises the held Guard, resolved authoritatively here.
		intent
			? {
					attack: intent.attack,
					skill: intent.skill,
					dodge: intent.dodge,
					guard: intent.guard,
				}
			: { attack: false },
		dt,
		weaponById(avatar.weapon),
	);
	avatar.attackT = r.attackT;
	// The i-frame Dodge timer + its post-recovery cooldown (ADR 0017 §5): both server-
	// tracked so the damage gates below negate hits during the active window and the
	// spam-gate bars a re-dodge. The hop impulse is the client's (ADR 0001).
	avatar.dodgeT = r.dodgeT;
	avatar.dodgeCdT = r.dodgeCdT;
	// The held-Guard timer (ADR 0017 §5): accumulated by the same shared gate that owns
	// the swing, so the server and the client's prediction can't disagree on a raise.
	avatar.guardT = r.guardT;
	avatar.hurtT = Math.max(0, avatar.hurtT - dt);
	// A fresh swing clears the per-swing hit list so it can connect again; an
	// in-flight swing keeps its list so it lands on each target only once (ADR 0017
	// §2 — the rate-limiter that replaced automatic post-hit i-frames).
	avatar.swingHits = r.swingStarted ? [] : (avatar.swingHits ?? []);
	if (r.skillFired) log.push(`${r.skillFired.name}!`);

	return {
		sa: { ...src, avatar, log, skillCooldowns: r.cooldowns },
		hb: r.hitbox,
		damage: r.damage,
	};
}

// Index of the Avatar nearest a Monster on the x-axis (-1 if the Zone is empty).
function nearestAvatar(avatars: ServerAvatar[], mx: number): number {
	let best = -1;
	let bestAdx = Infinity;
	for (let i = 0; i < avatars.length; i++) {
		const adx = Math.abs(avatars[i].avatar.x - mx);
		if (adx < bestAdx) {
			bestAdx = adx;
			best = i;
		}
	}
	return best;
}

/**
 * Advance one Zone a single tick under server authority. Deterministic given the
 * prior state, the per-Avatar intents, and dt. Owns Monster AI/HP, hit
 * resolution, Avatar HP / death / respawn, and last-hitter loot/XP (the
 * per-contributor instanced-loot split is a separate issue).
 */
export function stepZone(
	state: ZoneState,
	intents: AvatarIntent[],
	dtMs: number,
): ZoneState {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const zone = state.zone;
	const t = zone.terrain;

	const byId = new Map(intents.map((i) => [i.sessionId, i]));
	// Working Avatar set, mutated as the Monster/Projectile loops resolve hits.
	const hitboxes: (Box | null)[] = [];
	const damages: number[] = [];
	const avatars: ServerAvatar[] = state.avatars.map((src) => {
		const intent = byId.get(src.sessionId);
		// Both the reported and missed-report paths fold through resolveAvatarIntent
		// so attackT AND skill cooldowns decay every tick (a missed report holds
		// position and projects no hitbox).
		const { sa, hb, damage } = resolveAvatarIntent(src, intent, dt);
		hitboxes.push(hb);
		damages.push(damage);
		return sa;
	});
	// Per-swing hit registry (ADR 0017 §2): one mutable Set per Avatar of the Monster
	// ids its current swing has already hit, seeded from `swingHits` (cleared on a
	// fresh swing by resolveAvatarIntent) and folded back onto each Avatar at tick
	// end. This — not invulnerability — rate-limits a multi-tick active window to one
	// hit per target, so a Staggered Monster stays hittable by the NEXT swing.
	const swingHits: Set<number>[] = avatars.map(
		(a) => new Set(a.avatar.swingHits ?? []),
	);

	const effects: Effect[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];

	const monsters: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		// The swing timer BEFORE this tick's decay — so the ranged-poker fire below can
		// detect the exact tick the swing crosses into its `active` phase (fire-on-active-
		// entry, the one-shot gate) without a per-monster "has fired" flag.
		const attackTBefore = m.attackT;
		m.attackT = Math.max(0, m.attackT - dt);
		// Ranged-poker fire cadence (ADR 0017 §8): decays toward 0, gating the next commit.
		m.fireCdT = Math.max(0, (m.fireCdT ?? 0) - dt);
		// Hitstun + Poise bookkeeping (ADR 0017 §2/§3): decay the Stagger timer and
		// regenerate the Poise pool under no pressure. `stunned` locks CONTROL (no AI),
		// not physics — the body below still integrates its Knockback impulse + gravity.
		m.stunT = Math.max(0, (m.stunT ?? 0) - dt);
		// Poise regenerates only under no pressure (ADR 0017 §3): the regen-delay timer
		// is reset on every hit below, so a flurry holds it > 0 and the pool purely
		// accumulates (and breaks); once hits stop, it drains and regen resumes.
		m.poiseT = Math.max(0, (m.poiseT ?? 0) - dt);
		if ((m.poiseT ?? 0) <= 0) m.poise = regenPoise(m, dt);
		const stunned = (m.stunT ?? 0) > 0;
		// A committer (chaser melee OR shooter ranged poker) that has begun a swing is
		// COMMITTED for the whole wind-up→active→recovery: it neither moves nor re-targets
		// nor re-commits until the swing fully recovers (attackT decays to 0). That
		// commitment is precisely what makes the recovery a punishable opening (ADR 0017
		// §9): the poker, too, holds its ground through the telegraph rather than kiting.
		const committed =
			(m.type === 'chaser' || m.type === 'shooter') && m.attackT > 0;

		const target = nearestAvatar(avatars, m.x);
		const dx = target >= 0 ? avatars[target].avatar.x - m.x : 0;
		const adx = Math.abs(dx);
		const engaged =
			!stunned && target >= 0 && m.type === 'shooter' && adx < SHOOTER.aggro;
		let moveX: -1 | 0 | 1;
		if (stunned || committed)
			// Staggered or mid-swing: no input drive. stepEntity still carries ivx
			// (Knockback) + gravity, and a committed swing holds its ground to strike.
			moveX = 0;
		else if (target >= 0 && m.type === 'chaser' && adx < MONSTER.chaserAggro)
			// hold (moveX 0) inside the deadzone so facing doesn't flip-flop frame
			// to frame when the Avatar is sitting on top of the chaser
			moveX = adx < MONSTER.chaserDeadzone ? 0 : dx > 0 ? 1 : -1;
		else if (engaged) moveX = adx < SHOOTER.keepDist ? (dx > 0 ? -1 : 1) : 0;
		else moveX = m.facing;
		const res = stepEntity(t, m, { moveX, jump: false }, dt);
		m = res.e;

		// patrol turn-around at walls and platform edges (suppressed while staggered or
		// committed to a swing — a committer faces its locked-in target, not its patrol)
		if (!stunned && !committed && m.onGround && !engaged) {
			const lead = moveX >= 0 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x);
			const footY = Math.ceil(m.y + BOX.h);
			if (res.hitWall || !isSolid(t, lead, footY))
				m.facing = m.facing === 1 ? -1 : 1;
		}

		// Ranged poker (ADR 0017 §8): the reworked shooter never auto-fires. While engaged
		// and free it FACES its target and, once off its fire cadence, COMMITS the shared
		// wind-up→active→recovery swing (the visible telegraph). It then fires exactly one
		// shot on the tick the swing crosses into its `active` phase, and arms `fireCdT` to
		// pace the next commit — so the Player reads the wind-up, then dodges/blocks/parries
		// the reactable shot or closes in to punish the recovery.
		if (engaged && !committed) m.facing = dx >= 0 ? 1 : -1;
		if (engaged && !committed && (m.fireCdT ?? 0) <= 0 && m.attackT <= 0)
			m = { ...m, attackT: SWING_TOTAL };
		if (
			m.type === 'shooter' &&
			swingPhase(attackTBefore) !== 'active' &&
			meleeActive(m.attackT)
		) {
			fired.push(spawnProjectile(nextProjectileId++, m, m.facing));
			m = { ...m, fireCdT: SHOOTER.fireCooldown };
		}

		// Melee committer (ADR 0017 §9): the reworked chaser deals damage ONLY through a
		// telegraphed phased swing — never by contact. When an Avatar is within reach and
		// the chaser is free (not staggered, not already mid-swing), it COMMITS: it faces
		// the target and loads the full wind-up→active→recovery into `attackT`. The
		// wind-up replicates through the action-state (snapshotFor) for the Player to
		// read; the active phase below is the only damaging window; and because `attackT`
		// stays > 0 through recovery, the committer cannot re-commit or cancel — that
		// recovery is the Player's punish opening.
		if (
			!stunned &&
			!committed &&
			m.type === 'chaser' &&
			target >= 0 &&
			adx <= MONSTER.meleeRange
		) {
			m.facing = dx >= 0 ? 1 : -1;
			m = { ...m, attackT: SWING_TOTAL };
		}

		// The committer's strike: during its active phase ONLY, project the melee hitbox
		// and apply the universal hit-reaction payload to each overlapping Avatar — the
		// exact same payload a Player's swing carries (ADR 0017 §2), so a committer can
		// Stagger a poise-broken Player. Gated by the victim's i-frames so the multi-tick
		// active window lands once. A break Staggers (Hitstun + a Mass-scaled Knockback
		// impulse); a chip just damages + flinches.
		if (m.type === 'chaser' && meleeActive(m.attackT)) {
			const hb = meleeHitbox(m);
			for (let i = 0; i < avatars.length; i++) {
				const a = avatars[i].avatar;
				// i-frame gate (ADR 0017 §5): a connect's automatic i-frames OR an active
				// Dodge negate the strike (avatarHittable folds in dodgeInvulnerable).
				// Dodging through the active frames is the demo.
				if (!avatarHittable(a) || !aabbOverlap(hb, entityBox(a))) continue;
				// Resolve the hit against the Avatar's Guard FIRST (ADR 0017 §5): a frontal
				// raise Parries it (in the opening window) or Blocks it (held past), a rear
				// hit ignores Guard. Lag-comp widens the Parry window by this input's
				// staleness (clamped in resolveGuard) so a Parry timed right on the Player's
				// delayed screen still resolves. The i-frame (set on every branch) gates the
				// multi-tick active window to one resolution per swing.
				const lagSlack = (byId.get(avatars[i].sessionId)?.lagMs ?? 0) / 1000;
				// Parry is a progression-gated Moveset ability (#170): a defender who has not
				// unlocked it Blocks even in the opening window. resolveGuard folds the gate in.
				const canParry = movesetUnlocked(
					'parry',
					avatars[i].progress.level,
					avatars[i].class ?? 'warrior',
				);
				const g = resolveGuard(
					a,
					m.x,
					MONSTER.meleeDamage,
					lagSlack,
					COMBAT.guard,
					canParry,
				);
				// Direction away from the Monster (0 when they share a column), reused by the
				// hurt-blood bias and the parry-clash flash.
				const away: -1 | 0 | 1 = a.x === m.x ? 0 : a.x > m.x ? 1 : -1;
				if (g.result === 'parry') {
					// Parry: negate the hit and dump big Poise onto the ATTACKER — a clean catch
					// breaks its pool and Staggers it, the Player's punish opening (ADR 0017 §5).
					const ap = applyPoiseDamage(m, g.attackerPoiseDump);
					m = { ...m, poise: ap.poise, poiseT: COMBAT.poise.regenDelay };
					if (ap.broke) {
						m = applyImpulse(
							m,
							COMBAT.knockback * -m.facing,
							-COMBAT.knockbackUp,
						);
						m = { ...m, stunT: COMBAT.hitstun };
					}
					// The parry-clash flash carries no `source`, so it reaches the parrier too
					// (clash flash + camera juice + sound). Keep the raised Guard; i-frame the
					// Avatar so the same active window can't re-trigger.
					effects.push(parryEffect(a, (away || 1) as Facing));
					avatars[i] = {
						...avatars[i],
						avatar: { ...a, hurtT: COMBAT.iframes },
					};
					continue;
				}
				// Block (chip + Poise drain → possible guard-break) or an unguarded/rear hit
				// (full payload). resolveGuard already reduced the HP and drained Poise for a
				// Block; for an unguarded hit, apply the full Poise damage here. A guard-break
				// and an unguarded Poise break both Stagger the Avatar through the same path.
				const unguarded =
					g.result === 'none' ? applyPoiseDamage(a, COMBAT.poiseDamage) : null;
				const broke = unguarded ? unguarded.broke : g.guardBroke;
				const poise = unguarded ? unguarded.poise : g.defenderPoise;
				let na: Entity = {
					...a,
					hp: a.hp - g.hpDamage,
					hurtT: COMBAT.iframes,
					poise,
					poiseT: COMBAT.poise.regenDelay,
				};
				if (broke) {
					// Stagger the Player: throw the body away from the Monster (Mass-scaled)
					// with a small upward pop and lock control for Hitstun. The impact Effect
					// carries NO `source`, so — like a Monster break — it reaches everyone in
					// range, including the victim's client (hitstop + camera-kick). A guard-break
					// Staggers through the same path, so turtling to a break is punished.
					na = applyImpulse(
						na,
						COMBAT.knockback * m.facing,
						-COMBAT.knockbackUp,
					);
					na = { ...na, stunT: COMBAT.hitstun };
					effects.push(impactEffect(a, m.facing, MONSTER.meleeDamage));
				} else if (g.result !== 'block') {
					// Hurt blood at the Avatar, biased away from the Monster (0 when they share
					// a column). Server-sourced — no `source` — so the snapshot delivers it to
					// the victim too, in sync with the hurt-flash (ADR 0013, #132). A clean Block
					// emits no blood — the brace soaked it, only the chip + Poise drain show.
					effects.push(hurtBloodEffect(a, away, MONSTER.meleeDamage));
				}
				avatars[i] = { ...avatars[i], avatar: na };
			}
		}

		// A landed hit applies the universal hit-reaction payload (ADR 0017 §2): always
		// HP damage + Poise damage, and — only on a Poise BREAK — Stagger (Hitstun) +
		// Knockback (a Mass-scaled impulse). The gate is the per-swing hit registry, NOT
		// invulnerability: a swing connects with each Monster once, but a NEW swing can
		// re-hit a Staggered target. First Avatar whose hitbox lands deals the hit and is
		// recorded as a contributor; credit accumulates across ticks so every Player who
		// helped shares in the kill (#37, stories 26/27).
		for (let i = 0; i < avatars.length; i++) {
			const hb = hitboxes[i];
			if (hb && !swingHits[i].has(m.id) && aabbOverlap(hb, entityBox(m))) {
				const sid = avatars[i].sessionId;
				swingHits[i].add(m.id);
				const facing = avatars[i].avatar.facing;
				// The attacker's Weapon drives the hit-reaction too (ADR 0017 §14): its
				// poise damage decides whether this connect breaks, and its Knockback the
				// throw on a break — so a greatsword staggers and launches where a dagger
				// only chips, from the stat block alone.
				const wpn = weaponById(avatars[i].avatar.weapon);
				const contributors = m.contributors?.includes(sid)
					? m.contributors
					: [...(m.contributors ?? []), sid];
				const { poise, broke } = applyPoiseDamage(m, wpn.poiseDamage);
				// Reset the regen-delay so a sustained flurry keeps the pool from healing
				// between swings (ADR 0017 §3).
				m = {
					...m,
					hp: m.hp - damages[i],
					poise,
					poiseT: COMBAT.poise.regenDelay,
					contributors,
				};
				if (broke) {
					// Poise break → Stagger: lock control for Hitstun and throw the body with
					// a Knockback impulse (applyImpulse scales by 1/Mass — a light Slime
					// rockets, a heavy body barely nudges), plus a small upward pop. The
					// impact Effect is the break punctuation the client keys hitstop +
					// camera-kick off. `source` attributes it for originator-suppression.
					m = applyImpulse(m, wpn.knockback * facing, -wpn.knockbackUp);
					m = { ...m, stunT: COMBAT.hitstun };
					// No `source`: like the death gore burst, the break is a "big moment"
					// delivered to EVERYONE in range — including the attacker, who needs it to
					// fire the camera-kick + hitstop. The client predicts only chip blood
					// (predictHitEffects), so there is no double-render of the impact spark.
					effects.push(impactEffect(m, facing, damages[i]));
				} else {
					// Chip: HP + Poise damage, no Stagger — the Slime barely flinches. One
					// blood burst at the site, biased along the attacker's facing, scaled by
					// the damage dealt (ADR 0013); `source` suppresses it back to the attacker.
					effects.push(bloodEffect(m, facing, damages[i], sid));
				}
				break;
			}
		}

		// Passive contact damage is GONE (ADR 0017 §9): overlapping a Monster does
		// nothing. All Monster melee now flows through the telegraphed active-phase
		// strike above, so every point of incoming damage was dodgeable/punishable.

		if (m.hp > 0) {
			monsters.push(m);
		} else {
			// A radial, high-intensity gore burst at the kill site (ADR 0013, #139):
			// tinted to the Monster's body colour, no `source`, so every Player in
			// range — including the killer — sees it.
			effects.push(deathGoreEffect(m));
			// Every contributor earns full XP (shared, not split) and rolls its own
			// private, per-Player-seeded loot — instanced, so there is no shared pile
			// and no kill-stealing (#37). Each grant updates only that Avatar's state;
			// snapshotFor delivers it to that Player alone.
			for (const sid of m.contributors ?? []) {
				const idx = avatars.findIndex((a) => a.sessionId === sid);
				if (idx >= 0) avatars[idx] = grantKill(avatars[idx]);
			}
			if (m.spawnIndex !== undefined)
				respawns.push({
					spawnIndex: m.spawnIndex,
					remaining: RESPAWN.delaySec,
				});
		}
	}

	// After the death loop, so timers added this tick wait a full tick.
	for (const r of zone.respawns) {
		const remaining = r.remaining - dt;
		if (remaining > 0) {
			respawns.push({ ...r, remaining });
			continue;
		}
		const s = zone.spawns[r.spawnIndex];
		monsters.push(
			spawnMonster(s.type, nextMonsterId++, s.x, s.y, r.spawnIndex),
		);
	}

	// Projectiles are first-class hits with a full counterplay set (ADR 0017 §8). Each
	// surviving shot resolves through the SAME hit path melee does — i-frame gate,
	// Guard, Poise break — so a heavy shot Staggers exactly like a swing. A `monster`
	// shot threatens Avatars (Dodge / Block / Parry-reflect / melee-swat); a `player`
	// shot — one a Parry reflected — threatens Monsters.
	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		// Travel direction, reused as the Knockback push + Effect bias (0 for a
		// stationary shot, e.g. a test fixture or a reflected zero-velocity pebble).
		const travel: -1 | 0 | 1 = pr.vx > 0 ? 1 : pr.vx < 0 ? -1 : 0;

		// A reflected (player-owned) shot threatens Monsters: it applies the full
		// hit-reaction payload through the same Poise-break path a Player's swing does,
		// crediting the parrier so a reflect kill earns XP/loot. Bounded to one Monster.
		if (pr.faction === 'player') {
			let consumed = false;
			for (let mi = 0; mi < monsters.length; mi++) {
				const tm = monsters[mi];
				if (!aabbOverlap(projectileBox(pr), entityBox(tm))) continue;
				const { poise, broke } = applyPoiseDamage(tm, pr.poiseDamage);
				const contributors = tm.contributors?.includes(pr.ownerId)
					? tm.contributors
					: [...(tm.contributors ?? []), pr.ownerId];
				let nm: Entity = {
					...tm,
					hp: tm.hp - pr.damage,
					poise,
					poiseT: COMBAT.poise.regenDelay,
					contributors,
				};
				if (broke) {
					nm = applyImpulse(nm, pr.knockback * travel, -pr.knockbackUp);
					nm = { ...nm, stunT: COMBAT.hitstun };
					effects.push(impactEffect(tm, (travel || 1) as Facing, pr.damage));
				} else {
					effects.push(bloodEffect(tm, (travel || 1) as Facing, pr.damage));
				}
				monsters[mi] = nm;
				consumed = true;
				break;
			}
			if (!consumed) projectiles.push(pr);
			continue;
		}

		// Melee swat (ADR 0017 §8): a Player's live active melee/skill hitbox DESTROYS a
		// hostile shot on contact — no reflect, the shot is simply gone. Checked before
		// the body hit so a well-timed swing is a valid counter. The impact burst (no
		// source) gives the clink + camera juice to everyone in range.
		let consumed = false;
		for (let i = 0; i < avatars.length; i++) {
			const hb = hitboxes[i];
			if (hb && aabbOverlap(hb, projectileBox(pr))) {
				effects.push({
					kind: 'impact',
					x: pr.x,
					y: pr.y,
					intensity: pr.damage,
					dir: (-travel || 1) as -1 | 0 | 1,
				});
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		// Otherwise the shot resolves against an Avatar's body. The i-frame gate
		// (automatic hurtT OR an active Dodge) negates it WITHOUT consuming it, so a
		// Dodge slips it and it flies on (ADR 0017 §5). A frontal Guard then Parries it
		// (reflect) or Blocks it (chip + Poise drain); an unguarded/rear hit takes the
		// full payload, Staggering on a Poise break exactly like a melee connect.
		for (let i = 0; i < avatars.length; i++) {
			const a = avatars[i].avatar;
			if (!avatarHittable(a) || !aabbOverlap(projectileBox(pr), entityBox(a)))
				continue;
			const lagSlack = (byId.get(avatars[i].sessionId)?.lagMs ?? 0) / 1000;
			// Parry-reflect is gated by the same Parry unlock (#170): un-unlocked, the shot
			// Blocks (chip) rather than reflecting. The gate flows through resolveGuard.
			const canParry = movesetUnlocked(
				'parry',
				avatars[i].progress.level,
				avatars[i].class ?? 'warrior',
			);
			// The shot's source is back along its travel; resolveGuard's frontal-arc
			// check needs a point on that side (a stationary shot is treated as frontal).
			const g = resolveGuard(
				a,
				a.x - travel,
				pr.damage,
				lagSlack,
				COMBAT.guard,
				canParry,
			);
			if (g.result === 'parry') {
				// Parry → REFLECT (ADR 0017 §8): the shot reverses, becomes the parrier's
				// (faction `player`, ownerId the parrier) and flies back to threaten the
				// shooter. Negated for the Avatar, who keeps the raised Guard and i-frames so
				// the same shot can't immediately re-resolve. The reflect IS the punish, so —
				// unlike a melee Parry — no attacker Poise dump here (the shooter is at range).
				projectiles.push({
					...pr,
					vx: -pr.vx,
					vy: -pr.vy,
					faction: 'player',
					ownerId: avatars[i].sessionId,
				});
				effects.push(parryEffect(a, (travel || 1) as Facing));
				avatars[i] = {
					...avatars[i],
					avatar: { ...a, hurtT: COMBAT.iframes },
				};
				consumed = true;
				break;
			}
			// Block (chip + Poise drain → possible guard-break) or unguarded/rear (full
			// payload). resolveGuard already reduced the HP + drained Poise for a Block; an
			// unguarded hit applies the shot's full Poise damage here. Either break Staggers
			// through the same path — the shot can throw the body like a melee hit.
			const unguarded =
				g.result === 'none' ? applyPoiseDamage(a, pr.poiseDamage) : null;
			const broke = unguarded ? unguarded.broke : g.guardBroke;
			const poise = unguarded ? unguarded.poise : g.defenderPoise;
			let na: Entity = {
				...a,
				hp: a.hp - g.hpDamage,
				hurtT: COMBAT.iframes,
				poise,
				poiseT: COMBAT.poise.regenDelay,
			};
			if (broke) {
				na = applyImpulse(na, pr.knockback * travel, -pr.knockbackUp);
				na = { ...na, stunT: COMBAT.hitstun };
				effects.push(impactEffect(a, (travel || 1) as Facing, pr.damage));
			} else if (g.result !== 'block') {
				// Hurt blood biased along the shot's travel; a clean Block soaked it (no blood,
				// only the chip + Poise drain). Server-sourced — delivered to the victim too.
				effects.push(hurtBloodEffect(a, travel, pr.damage));
			}
			avatars[i] = { ...avatars[i], avatar: na };
			consumed = true;
			break;
		}
		if (!consumed) projectiles.push(pr);
	}
	projectiles.push(...fired);

	// Forgiving death: respawn at the safe point, full HP, brief i-frames. The
	// session ids are reported so the world layer can relocate the respawn to Town.
	const deaths: number[] = [];
	for (let i = 0; i < avatars.length; i++) {
		const a = avatars[i].avatar;
		if (a.hp <= 0) {
			deaths.push(avatars[i].sessionId);
			// Radial gore burst at the spot the Avatar fell, tinted to the Avatar's
			// cosmetic hue — emitted before the teleport below moves them to the safe
			// point (ADR 0013, #139).
			effects.push(deathGoreEffect(a));
			avatars[i] = {
				...avatars[i],
				avatar: {
					...a,
					hp: a.maxHp,
					x: SPAWN.x,
					y: SPAWN.y,
					vx: 0,
					vy: 0,
					hurtT: 1,
				},
				log: [...avatars[i].log, 'You fell. Respawned in safety.'],
			};
		}
	}

	// Persist each Avatar's per-swing hit registry for the next tick (ADR 0017 §2):
	// an in-flight swing keeps the ids it has already hit so it can't double-hit them,
	// and resolveAvatarIntent clears the list when the next swing starts.
	for (let i = 0; i < avatars.length; i++)
		avatars[i] = {
			...avatars[i],
			avatar: { ...avatars[i].avatar, swingHits: [...swingHits[i]] },
		};

	const newZone: Zone = {
		...zone,
		monsters,
		projectiles,
		nextProjectileId,
		respawns,
		nextMonsterId,
	};
	return { zone: newZone, avatars, tick: state.tick + 1, deaths, effects };
}

// Award XP (+ any level-up HP bump) and an instanced loot roll to one Avatar.
function grantKill(sa: ServerAvatar): ServerAvatar {
	// Logs are already trimmed to the last 5 by resolveAvatarIntent; accumulate
	// this tick's messages without re-trimming so the order matches single-player.
	const ap = applyXp(sa.progress, XP_PER_KILL);
	const log = [...sa.log];
	let avatar = sa.avatar;
	if (ap.leveled > 0) {
		const mhp = maxHpForLevel(ap.progress.level);
		avatar = { ...avatar, maxHp: mhp, hp: mhp };
		log.push(`Level up! Now level ${ap.progress.level}.`);
	}
	const roll = rollItem(sa.rngState, ap.progress.level);
	const item = { ...roll.item, id: sa.nextId };
	log.push(`Looted ${item.rarity} ${item.base}.`);
	return {
		...sa,
		avatar,
		progress: ap.progress,
		inventory: [...sa.inventory, item],
		nextId: sa.nextId + 1,
		rngState: roll.state,
		log,
	};
}

// Build the per-recipient snapshot: the full authoritative Zone view (every
// Avatar + Monster + Projectile) plus this session's private progress / inventory
// / log. The recipient reconciles its own HP/respawn by finding `sessionId`.
export function snapshotFor(
	state: ZoneState,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	const me = state.avatars.find((a) => a.sessionId === sessionId);
	const avatars: AvatarSnapshot[] = state.avatars.map((a) => ({
		sessionId: a.sessionId,
		handle: a.handle,
		cosmetics: a.cosmetics,
		x: a.avatar.x,
		y: a.avatar.y,
		vx: a.avatar.vx,
		vy: a.avatar.vy,
		facing: a.avatar.facing,
		onGround: a.avatar.onGround,
		hp: a.avatar.hp,
		maxHp: a.avatar.maxHp,
		hurtT: a.avatar.hurtT,
		// The equipped Weapon index joins the broadcast appearance (ADR 0017 §14), so
		// every other client renders THIS Avatar's weapon — composited sprite + trail.
		weapon: a.avatar.weapon ?? DEFAULT_WEAPON,
		// Derived from the Avatar's swing timer AGAINST its weapon's phase durations, so
		// every other client can render the swing (ADR 0017 §10) — this is what makes the
		// basic attack visible to others, and a slow greatsword read as slow. The parry
		// stance flag is gated by the Parry Moveset unlock (#170) so observers never see a
		// not-yet-earned defender flash a parry it cannot perform.
		action: actionStateOf(
			a.avatar,
			weaponById(a.avatar.weapon).swing,
			movesetUnlocked('parry', a.progress.level, a.class ?? 'warrior'),
		),
	}));
	const monsters: MonsterSnapshot[] = state.zone.monsters.map((m) => ({
		id: m.id,
		type: m.type,
		x: m.x,
		y: m.y,
		vx: m.vx,
		vy: m.vy,
		facing: m.facing,
		onGround: m.onGround,
		hp: m.hp,
		maxHp: m.maxHp,
		hurtT: m.hurtT,
		// Both committer archetypes — the melee chaser and the ranged-poker shooter — run
		// the shared phase machine on their `attackT`, so each replicates its real swing
		// action-state and its wind-up telegraph is visible to the Player (ADR 0017
		// §8/§9/§10). A Staggered Monster of either type surfaces its reaction through the
		// action `flags`.
		action:
			m.type === 'chaser' || m.type === 'shooter'
				? actionStateOf(m)
				: { ...IDLE_ACTION, flags: actionFlags(m) },
	}));
	// Originator-suppression (ADR 0013): an Effect is never sent back to the
	// session that caused it — the acting client already predicted its own blood,
	// so re-rendering it from the snapshot would double up. `source` is attribution
	// only; strip it so the wire Effect stays the pure { kind, x, y, intensity, dir }.
	const effects: Effect[] = (state.effects ?? [])
		.filter((e) => e.source !== sessionId)
		.map(({ source: _source, ...e }) => e);
	return {
		t: 'snapshot',
		tick: state.tick,
		zoneId: state.zone.id,
		avatars,
		monsters,
		projectiles: state.zone.projectiles,
		effects,
		progress: me?.progress ?? { level: 1, xp: 0, gold: 0 },
		inventory: me?.inventory ?? [],
		log: me?.log ?? [],
	};
}

// --- Server session helpers -------------------------------------------------

export function createZoneState(zone: Zone): ZoneState {
	return { zone, avatars: [], tick: 0 };
}

// Add a freshly-spawned Avatar for a connecting session. The entity id mirrors
// the session id (Avatars are identified by session on the wire).
export function addAvatar(
	state: ZoneState,
	sessionId: number,
	handle: string,
	cosmetics: Cosmetics = DEFAULT_COSMETICS,
	weapon: number = DEFAULT_WEAPON,
): ZoneState {
	const sa: ServerAvatar = {
		sessionId,
		handle,
		cosmetics,
		// The chosen Weapon rides the connect handshake (ADR 0017 §14) and lives on the
		// Avatar entity, where it drives both combat resolution and the broadcast look.
		avatar: { ...spawnAvatar(SPAWN.x, SPAWN.y), id: sessionId, weapon },
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: ['Welcome. Hunt the chasers (j attack, k guard/parry).'],
		nextId: 1,
		rngState: sessionId,
		class: 'warrior',
		skillCooldowns: {},
	};
	return { ...state, avatars: [...state.avatars, sa] };
}

// Remove a session's Avatar on socket close.
export function removeAvatar(state: ZoneState, sessionId: number): ZoneState {
	return {
		...state,
		avatars: state.avatars.filter((a) => a.sessionId !== sessionId),
	};
}
