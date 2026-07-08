// The server-authoritative Zone simulation and the client-local Avatar prediction
// step (ADR 0006). The server advances Monsters/Projectiles and owns every Avatar
// consequence (HP, death/respawn, loot, XP); the client predicts only its own
// Avatar's physics. Both deterministic so the two sides can't diverge.

import {
	aabbOverlap,
	actionFlags,
	actionStateOf,
	applyPoiseDamage,
	avatarHittable,
	combatEventAt,
	deathEvent,
	effectsOf,
	entityBox,
	IDLE_ACTION,
	meleeActive,
	meleeHitbox,
	meleeProfileOf,
	regenPoise,
	resolveGuard,
	resolveHitsOnMonsters,
	SWING_TOTAL,
	stepAvatarCombat,
	swatEvent,
	swingPhase,
} from './combat';
import { BOX, COMBAT, LOOT, PHYS, RESPAWN, SHOOTER, SPAWN } from './constants';
import { clampCosmetics, DEFAULT_COSMETICS } from './cosmetics';
import { emoteById, emoteInterrupted, initialEmoteT, stepEmote } from './emote';
import { itemLabel, type LootTable, lootTableFor, rollDrop } from './loot';
import type { RestoredAvatar } from './persistence';
import { applyImpulse, stepEntity } from './physics';
import { spawnAvatar } from './player';
import { applyXp, maxHpForLevel, xpForKill } from './progression';
import { projectileBox, spawnProjectile, stepProjectile } from './projectile';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from './protocol';
import {
	type PlayerClass,
	skillForSlot,
	skillsUnlockedBetween,
} from './skills';
import { isSolid } from './terrain';
import type {
	Control,
	Cosmetics,
	Drop,
	Effect,
	Entity,
	EntityType,
	Facing,
	Item,
	PendingRespawn,
	PlayerProgress,
	Projectile,
	Strike,
	Terrain,
} from './types';
import { DEFAULT_WEAPON, weaponById } from './weapons';
import { spawnMonster, type Zone, type ZoneId } from './world';

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
	// The last safe Town this Avatar stood in (#236): persisted so login returns here,
	// not to the logged-off position. Absent until first placed; never on the wire.
	lastTown?: ZoneId;
	// Durable "completed the demo" bit, persisted per account (#236). Absent == false;
	// server-owned, never replicated.
	bossDefeated?: boolean;
}

export interface ZoneState {
	zone: Zone;
	avatars: ServerAvatar[];
	tick: number;
	// Sessions whose Avatar hit 0 HP this tick (transient output). The Zone respawns
	// them in place; the world layer uses this to relocate the death to Town (#33).
	deaths?: number[];
	// Combat Effects emitted this tick (transient output, ADR 0013): one blood burst
	// per damage site, realized client-side into Particles.
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
	// Reported external-impulse channel (ADR 0017): carried so a client-applied
	// Dodge/Knockback hop persists server-side (position is never re-simulated).
	// Absent == unchanged.
	ivx?: number;
	facing: Facing;
	onGround: boolean;
	attack: boolean;
	guard?: boolean; // raise the Guard this tick (ADR 0017 §5); absent == false
	interact?: boolean; // request a Portal transition; resolved by the world layer
	dodge?: boolean; // start an i-frame Dodge hop this tick (ADR 0017 §5)
	skill?: number;
	// A freshly-triggered body emote this tick (ADR 0020 §9). A one-shot edge — present
	// only on the trigger tick, not every input — so it doesn't re-fire while held.
	emote?: string;
}

/**
 * Client-local prediction of the own Avatar: shared physics plus local timer decay,
 * so movement and the swing telegraph feel instant between ~20 Hz snapshots. Only
 * advances physics and decays `hurtT` — `attackT` decay lives in `resolveCombat`.
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
	// Predict the emote the same way the server does (ADR 0020 §9), so the owner sees
	// its own `/em wave` and its cancel-on-move with no round-trip. The trigger itself
	// is applied where the chat command is parsed (index.ts).
	const em = stepEmote(e.emoteId, e.emoteT ?? 0, emoteInterrupted(e), dt);
	e.emoteId = em.emoteId ?? undefined;
	e.emoteT = em.emoteT;
	return e;
}

// Server adapter over the shared fold `stepAvatarCombat` (ADR 0022): runs the SAME
// fold the client predicts with, then layers server-owned vitals (hurtT decay), the
// emote step, and the skill-name log. Returns the Strikes projected this tick (0 or 1)
// plus the folded ServerAvatar. A missed report holds position and runs an empty Intent
// so the decay (attackT + skill cooldowns) still happens.
function resolveAvatarIntent(
	src: ServerAvatar,
	intent: AvatarIntent | undefined,
	dt: number,
): { sa: ServerAvatar; strikes: Strike[] } {
	// Trust the client's kinematics, keep the server-owned vitals; with no report, hold
	// the prior kinematics. Skill cooldowns are seeded onto the entity from the persisted
	// `ServerAvatar.skillCooldowns` so the shared fold reads and advances them (ADR 0022).
	const avatar: Entity = intent
		? {
				...src.avatar,
				x: intent.x,
				y: intent.y,
				vx: intent.vx,
				vy: intent.vy,
				// Carry the reported impulse so a client-integrated Dodge/Knockback hop
				// persists (absent == keep the prior residual).
				ivx: intent.ivx ?? src.avatar.ivx,
				facing: intent.facing,
				onGround: intent.onGround,
				skillCooldowns: src.skillCooldowns ?? {},
			}
		: { ...src.avatar, skillCooldowns: src.skillCooldowns ?? {} };

	const log = src.log.slice(-5);
	// The shared combat fold (ADR 0022): the equipped Weapon contributes only its damage
	// through the gate (timing and arc are the one shared moveset, ADR 0024; absent ==
	// default sword). `dodge` is the client's already-gated decision (grounded + moving
	// checked before the hop ungrounds the body, ADR 0017 §5); the server only re-enforces
	// the tick-stable timing here.
	const cls = src.class ?? 'warrior';
	const fold = stepAvatarCombat(
		avatar,
		intent
			? {
					attack: intent.attack,
					skill: intent.skill,
					dodge: intent.dodge,
					guard: intent.guard,
				}
			: { attack: false },
		{
			level: src.progress.level,
			cls,
			weapon: weaponById(avatar.weapon),
			dt,
		},
	);
	const folded = fold.avatar;
	folded.hurtT = Math.max(0, folded.hurtT - dt);
	// Body emote (ADR 0020 §9): a fresh `/em` trigger arms it, then the shared step
	// advances and cancels it when the Avatar acts. Evaluated AFTER the swing/guard fold
	// so the cancel reads this tick's resolved state.
	if (intent?.emote) {
		const def = emoteById(intent.emote);
		if (def) {
			folded.emoteId = def.id;
			folded.emoteT = initialEmoteT(def);
		}
	}
	const em = stepEmote(
		folded.emoteId,
		folded.emoteT ?? 0,
		emoteInterrupted(folded),
		dt,
	);
	folded.emoteId = em.emoteId ?? undefined;
	folded.emoteT = em.emoteT;
	// Skill-name log (ADR 0022): a fire is OBSERVED from the cooldown delta — the pressed
	// slot's cooldown rose from its pre-fold value — so the unlock/cooldown decision stays
	// single-homed in `resolveCombat`.
	const slotSkill =
		intent?.skill !== undefined ? skillForSlot(cls, intent.skill) : undefined;
	if (
		slotSkill &&
		(folded.skillCooldowns?.[slotSkill.id] ?? 0) >
			(avatar.skillCooldowns?.[slotSkill.id] ?? 0)
	)
		log.push(`${slotSkill.name}!`);

	// The persisted `ServerAvatar.skillCooldowns` mirrors the entity's object so the
	// world layer + tests keep reading them off the ServerAvatar.
	return {
		sa: {
			...src,
			avatar: folded,
			log,
			skillCooldowns: folded.skillCooldowns ?? {},
		},
		strikes: fold.strikes,
	};
}

// Fold every Avatar's Intent through the shared `stepAvatarCombat`, producing the
// advanced ServerAvatars plus the flat `Strike[]` `resolveHitsOnMonsters` consumes.
// Each Avatar projects 0 or 1 Strikes carrying its `attackerId`, so resolution keys
// the victim ledger and Knockback back to the right Avatar (ADR 0022).
function stepAvatars(
	state: ZoneState,
	byId: Map<number, AvatarIntent>,
	dt: number,
): { avatars: ServerAvatar[]; strikes: Strike[] } {
	const strikes: Strike[] = [];
	const avatars = state.avatars.map((src) => {
		const res = resolveAvatarIntent(src, byId.get(src.sessionId), dt);
		strikes.push(...res.strikes);
		return res.sa;
	});
	return { avatars, strikes };
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
 * Advance one Zone a single tick under server authority. Deterministic given the prior
 * state, intents, and dt. Owns Monster AI/HP, hit resolution, Avatar HP/death/respawn,
 * and loot/XP.
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
	// `avatars` is the working set, mutated as the Monster/Projectile loops resolve hits.
	const { avatars, strikes } = stepAvatars(state, byId, dt);
	// Per-swing hit registry (ADR 0017 §2): `attackerId → Monster ids this swing has hit`,
	// seeded from each Avatar's `swingHits` and folded back at tick end. This — not
	// invulnerability — limits a multi-tick active window to one hit per target, so a
	// Staggered Monster stays hittable by the NEXT swing.
	const swingHits = new Map<number, Set<number>>(
		avatars.map((a) => [a.avatar.id, new Set(a.avatar.swingHits ?? [])]),
	);

	const effects: Effect[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];
	// Resting Drops carried from the prior tick (#238): kills append, the collection pass
	// grabs the ones underfoot and fades the expired, survivors thread back onto the Zone.
	const drops: Drop[] = [...(zone.drops ?? [])];
	let nextDropId = zone.nextDropId ?? 1;
	const lootTable = lootTableFor(zone.id);

	const advanced: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		// The swing timer BEFORE decay, so the fire below detects the exact tick the swing
		// enters its `active` phase — a one-shot gate without a per-monster "has fired" flag.
		const attackTBefore = m.attackT;
		m.attackT = Math.max(0, m.attackT - dt);
		// Ranged-poker fire cadence (ADR 0017 §8): decays toward 0, gating the next commit.
		m.attackCdT = Math.max(0, (m.attackCdT ?? 0) - dt);
		// Hitstun + Poise bookkeeping (ADR 0017 §2/§3). `stunned` locks CONTROL (no AI), not
		// physics — the body below still integrates its Knockback impulse + gravity.
		m.stunT = Math.max(0, (m.stunT ?? 0) - dt);
		// Poise regenerates only under no pressure (ADR 0017 §3): the regen-delay timer is
		// reset on every hit, so a flurry holds it > 0; once hits stop it drains and regen resumes.
		m.poiseT = Math.max(0, (m.poiseT ?? 0) - dt);
		if ((m.poiseT ?? 0) <= 0) m.poise = regenPoise(m, dt);
		const stunned = (m.stunT ?? 0) > 0;
		// A committer mid-swing is COMMITTED for the whole wind-up→active→recovery: no move,
		// re-target, or re-commit until attackT decays to 0. That commitment makes the
		// recovery a punishable opening (ADR 0017 §9).
		const committed = m.type !== 'player' && m.attackT > 0;
		// One code path for the chaser and brute (approach → commit → strike); null for the shooter.
		const melee = meleeProfileOf(m.type);

		const target = nearestAvatar(avatars, m.x);
		const dx = target >= 0 ? avatars[target].avatar.x - m.x : 0;
		const adx = Math.abs(dx);
		const engaged =
			!stunned && target >= 0 && m.type === 'shooter' && adx < SHOOTER.aggro;
		let moveX: -1 | 0 | 1;
		if (stunned || committed)
			// Staggered or mid-swing: no input drive. stepEntity still carries ivx + gravity;
			// a committed swing holds its ground to strike.
			moveX = 0;
		else if (melee && target >= 0 && adx < melee.aggro)
			// Close on the target; hold inside the deadzone so facing doesn't flip-flop when
			// the Avatar is sitting on top of it.
			moveX = adx < melee.deadzone ? 0 : dx > 0 ? 1 : -1;
		else if (engaged) moveX = adx < SHOOTER.keepDist ? (dx > 0 ? -1 : 1) : 0;
		else moveX = m.facing;
		const res = stepEntity(t, m, { moveX, jump: false }, dt);
		m = res.e;

		// Patrol turn-around at walls and platform edges (suppressed while staggered or
		// committed — a committer faces its target, not its patrol).
		if (!stunned && !committed && m.onGround && !engaged) {
			const lead = moveX >= 0 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x);
			const footY = Math.ceil(m.y + BOX.h);
			if (res.hitWall || !isSolid(t, lead, footY))
				m.facing = m.facing === 1 ? -1 : 1;
		}

		// Ranged poker (ADR 0017 §8): never auto-fires. Engaged and free, it faces its target
		// and, off its fire cadence, COMMITS the shared swing, firing one shot on the tick it
		// enters `active` and arming `attackCdT` — so the Player reads the wind-up, then
		// dodges/blocks the reactable shot or punishes the recovery.
		if (engaged && !committed) m.facing = dx >= 0 ? 1 : -1;
		if (engaged && !committed && (m.attackCdT ?? 0) <= 0 && m.attackT <= 0)
			m = { ...m, attackT: SWING_TOTAL };
		if (
			m.type === 'shooter' &&
			swingPhase(attackTBefore) !== 'active' &&
			meleeActive(m.attackT)
		) {
			fired.push(spawnProjectile(nextProjectileId++, m, m.facing));
			m = { ...m, attackCdT: SHOOTER.fireCooldown };
		}

		// Melee committer (ADR 0017 §9): damage ONLY through the telegraphed swing, never by
		// contact. When an Avatar is in reach and the committer is free (not staggered, not
		// mid-swing, off its commit cooldown), it faces the target, loads the swing into
		// `attackT`, and arms `attackCdT` (0 for the chaser, which re-commits immediately).
		if (
			!stunned &&
			!committed &&
			melee &&
			target >= 0 &&
			adx <= melee.range &&
			(m.attackCdT ?? 0) <= 0
		) {
			m.facing = dx >= 0 ? 1 : -1;
			m = { ...m, attackT: SWING_TOTAL, attackCdT: melee.commitCd };
		}

		// Active phase ONLY: project the hitbox and apply the SAME hit-reaction payload a
		// Player's swing carries (ADR 0017 §2), so a committer can Stagger a poise-broken
		// Player. i-frame-gated so the multi-tick window lands once.
		if (melee && meleeActive(m.attackT)) {
			const hb = meleeHitbox(m);
			for (let i = 0; i < avatars.length; i++) {
				const a = avatars[i].avatar;
				// i-frame gate (ADR 0017 §5): automatic i-frames OR an active Dodge negate the
				// strike. Dodging through the active frames is the demo.
				if (!avatarHittable(a) || !aabbOverlap(hb, entityBox(a))) continue;
				// Resolve against Guard FIRST (ADR 0017 §5): a frontal raise Blocks (chip +
				// Poise drain), a rear hit ignores Guard.
				const g = resolveGuard(a, m.x, melee.damage);
				// Direction away from the Monster (0 when they share a column); reused as the blood bias.
				const away: -1 | 0 | 1 = a.x === m.x ? 0 : a.x > m.x ? 1 : -1;
				// Block (resolveGuard already cut HP + drained Poise) or unguarded/rear hit (apply
				// full Poise damage here). Either break Staggers through the same path.
				const unguarded =
					g.result === 'none' ? applyPoiseDamage(a, melee.poise) : null;
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
					// Stagger: throw the body away (Mass-scaled) with a small upward pop and
					// lock control for Hitstun.
					na = applyImpulse(
						na,
						COMBAT.knockback * m.facing,
						-COMBAT.knockbackUp,
					);
					na = { ...na, stunT: COMBAT.hitstun };
					// `break` CombatEvent → impact via `effectsOf` (ADR 0019). No `source`, so it
					// reaches everyone including the victim's client (hitstop + camera-kick).
					effects.push(
						...effectsOf(combatEventAt('break', a, m.facing, melee.damage)),
					);
				} else if (g.result !== 'block') {
					// `hit` CombatEvent → blood via `effectsOf`, biased away from the Monster. NO
					// `source`: incoming hurt is never predicted (ADR 0013 §3), so the snapshot
					// delivers it to the victim too. A clean Block emits no blood — only chip + drain.
					effects.push(
						...effectsOf(combatEventAt('hit', a, away, melee.damage)),
					);
				}
				avatars[i] = { ...avatars[i], avatar: na };
			}
		}

		// No passive contact damage (ADR 0017 §9): all Monster melee flows through the
		// telegraphed active-phase strike above, so every hit is dodgeable/punishable.

		advanced.push(m);
	}

	// Resolve Avatar swings → Monsters (ADR 0022): each player-faction Strike lands on
	// the Monsters it newly strikes, applying the hit-reaction off the per-swing
	// `swingHits` table. Runs AFTER monster AI so a swing sees post-move Monsters.
	const hitsOnMonsters = resolveHitsOnMonsters(advanced, strikes, swingHits);
	effects.push(...hitsOnMonsters.effects);

	// The death DECISION stays here (ADR 0019/0022): a Monster at 0 HP sprays gore and
	// joins the death set; the world-state consequences defer to `resolveDeaths`. Removal
	// is implicit — only survivors re-enter `monsters`.
	const monsters: Entity[] = [];
	const deadMonsters: Entity[] = [];
	for (const m of hitsOnMonsters.monsters) {
		if (m.hp > 0) {
			monsters.push(m);
			continue;
		}
		// `death` CombatEvent → a radial gore burst tinted to the Monster's body colour
		// (ADR 0013 #139). No `source`, so everyone in range — the killer included — sees it.
		effects.push(...effectsOf(deathEvent(m)));
		deadMonsters.push(m);
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

	// Projectiles resolve through the SAME hit path melee does (ADR 0017 §8) — i-frame
	// gate, Guard, Poise break — so a heavy shot Staggers like a swing, countered by
	// Dodge, Block, or a melee swat.
	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		// Travel direction, reused as the Knockback push + Effect bias (0 for a
		// stationary shot, e.g. a test fixture).
		const travel: -1 | 0 | 1 = pr.vx > 0 ? 1 : pr.vx < 0 ? -1 : 0;

		// Melee swat (ADR 0017 §8): a live player Strike DESTROYS a hostile shot on contact.
		// Checked before the body hit so a well-timed swing is a valid counter.
		let consumed = false;
		for (const s of strikes) {
			if (aabbOverlap(s.hitbox, projectileBox(pr))) {
				// `swat` CombatEvent → a light clink (no Poise bump, distinct from a break),
				// source-less so it reaches everyone. Biased back along the swat (`-travel`).
				effects.push(...effectsOf(swatEvent(pr, (-travel || 1) as Facing)));
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		// Otherwise the shot resolves against a body. The i-frame gate negates it WITHOUT
		// consuming it, so a Dodge slips it and it flies on (ADR 0017 §5); a frontal Guard
		// Blocks, an unguarded/rear hit takes the full payload.
		for (let i = 0; i < avatars.length; i++) {
			const a = avatars[i].avatar;
			if (!avatarHittable(a) || !aabbOverlap(projectileBox(pr), entityBox(a)))
				continue;
			// The shot's source is back along its travel; resolveGuard's frontal-arc
			// check needs a point on that side (a stationary shot is treated as frontal).
			const g = resolveGuard(a, a.x - travel, pr.damage);
			// Block (resolveGuard already cut HP + drained Poise) or unguarded/rear hit (apply
			// full Poise damage here). Either break Staggers — the shot can throw the body.
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
				// `break` CombatEvent → impact via `effectsOf`; source-less (hitstop +
				// camera-kick for everyone, the victim included).
				effects.push(
					...effectsOf(combatEventAt('break', a, travel || 1, pr.damage)),
				);
			} else if (g.result !== 'block') {
				// `hit` CombatEvent → blood, biased along travel. NO `source`: incoming hurt is
				// never predicted (ADR 0013 §3), so the snapshot delivers it to the victim too.
				effects.push(...effectsOf(combatEventAt('hit', a, travel, pr.damage)));
			}
			avatars[i] = { ...avatars[i], avatar: na };
			consumed = true;
			break;
		}
		if (!consumed) projectiles.push(pr);
	}
	projectiles.push(...fired);

	// The death-consequences pass (ADR 0022): pays out the death set decided above. The
	// Avatar in-place respawn is deferred to AFTER the collection pass below so a dying
	// contributor still grabs its loot; fresh Drops append to this tick's `drops` (#238).
	const deathPass = resolveDeaths(avatars, deadMonsters, {
		zoneId: zone.id,
		lootTable,
		nextDropId,
	});
	const resolved = deathPass.avatars;
	respawns.push(...deathPass.respawns);
	effects.push(...deathPass.effects);
	drops.push(...deathPass.drops);
	nextDropId = deathPass.nextDropId;

	// Collect + age the in-world Drops (#238). A Drop is PRIVATE to its owner: picked up
	// when the owner's body overlaps it, faded once its ttl drains. Runs BEFORE the death
	// respawn, so an Avatar (including one that died this tick) grabs loot where it stands.
	const survivingDrops: Drop[] = [];
	for (const d of drops) {
		const ttl = d.ttl - dt;
		if (ttl <= 0) continue; // faded out
		const idx = resolved.findIndex((a) => a.sessionId === d.owner);
		if (idx >= 0 && aabbOverlap(entityBox(resolved[idx].avatar), d)) {
			const sa = resolved[idx];
			resolved[idx] = {
				...sa,
				inventory: [...sa.inventory, d.item],
				log: [...sa.log, `Looted ${itemLabel(d.item)}.`],
			};
			continue; // collected — dropped from the surviving list
		}
		survivingDrops.push({ ...d, ttl });
	}

	// Forgiving respawn for the Avatars reported dead: safe point, full HP, brief i-frames.
	// Deferred to after loot collection so a dying Avatar keeps what it fell on; the world
	// layer escalates this to a cross-zone Town move.
	for (const sid of deathPass.deaths) {
		const i = resolved.findIndex((a) => a.sessionId === sid);
		if (i < 0) continue;
		const a = resolved[i].avatar;
		resolved[i] = {
			...resolved[i],
			avatar: {
				...a,
				hp: a.maxHp,
				x: SPAWN.x,
				y: SPAWN.y,
				vx: 0,
				vy: 0,
				hurtT: 1,
			},
			log: [...resolved[i].log, 'You fell. Respawned in safety.'],
		};
	}

	// Persist each Avatar's per-swing hit registry for the next tick (ADR 0017 §2): an
	// in-flight swing keeps the ids it has hit so it can't double-hit them (the fold clears
	// them on a fresh swing). Keyed by Avatar id, so it survives a fresh Avatar array.
	for (let i = 0; i < resolved.length; i++)
		resolved[i] = {
			...resolved[i],
			avatar: {
				...resolved[i].avatar,
				swingHits: [...(swingHits.get(resolved[i].avatar.id) ?? [])],
			},
		};

	const newZone: Zone = {
		...zone,
		monsters,
		projectiles,
		nextProjectileId,
		respawns,
		nextMonsterId,
		drops: survivingDrops,
		nextDropId,
	};
	return {
		zone: newZone,
		avatars: resolved,
		tick: state.tick + 1,
		deaths: deathPass.deaths,
		effects,
	};
}

/**
 * The death-consequences pass (ADR 0022), preserving the monster-local / avatar-escalates
 * asymmetry:
 *   - Monsters: shared XP + instanced loot to each contributor (#37) and respawn
 *     scheduling, all zone-local. Removal is implicit (the caller re-collects survivors).
 *   - Avatars: emit ONLY the died-this-tick set + fall gore. The in-place respawn is left
 *     to the caller so it runs AFTER loot collection; cross-zone respawn into Town escalates
 *     to `stepServerWorld`, so this pass never reaches across zones.
 */
export function resolveDeaths(
	avatars: ServerAvatar[],
	deadMonsters: Entity[],
	ctx: { zoneId: ZoneId; lootTable: LootTable; nextDropId: number },
): {
	avatars: ServerAvatar[];
	drops: Drop[];
	nextDropId: number;
	respawns: PendingRespawn[];
	deaths: number[];
	effects: Effect[];
} {
	const next = avatars.slice();
	const drops: Drop[] = [];
	const respawns: PendingRespawn[] = [];
	let nextDropId = ctx.nextDropId;
	// Every contributor earns full XP (shared, not split) and rolls its own private,
	// per-Player-seeded loot — instanced, so no shared pile and no kill-stealing (#37).
	// The roll leaves an in-world Drop at the kill site owned by that contributor.
	for (const m of deadMonsters) {
		for (const sid of m.contributors ?? []) {
			const idx = next.findIndex((a) => a.sessionId === sid);
			if (idx < 0) continue;
			let sa = grantXp(next[idx], m.type, ctx.zoneId);
			const roll = rollDrop(sa.rngState, sa.progress.level, ctx.lootTable);
			sa = { ...sa, rngState: roll.state };
			if (roll.item) {
				drops.push(
					spawnDrop(nextDropId++, sid, m, { ...roll.item, id: sa.nextId }),
				);
				sa = { ...sa, nextId: sa.nextId + 1 };
			}
			next[idx] = sa;
		}
		if (m.spawnIndex !== undefined)
			respawns.push({ spawnIndex: m.spawnIndex, remaining: RESPAWN.delaySec });
	}

	// Report the died-this-tick set and spray the fall gore at the death site; the respawn
	// is left to the caller (runs after loot collection).
	const deaths: number[] = [];
	const effects: Effect[] = [];
	for (const sa of next) {
		if (sa.avatar.hp <= 0) {
			deaths.push(sa.sessionId);
			// `death` CombatEvent → a radial gore burst tinted to the Avatar's cosmetic hue
			// (ADR 0013 #139), at the fall site — the caller teleports to safety afterwards.
			effects.push(...effectsOf(deathEvent(sa.avatar)));
		}
	}

	return { avatars: next, drops, nextDropId, respawns, deaths, effects };
}

// Award shared kill XP (+ any level-up HP bump) to one contributor. The grant scales with
// the Monster's archetype and Zone depth (xpForKill, #266). The loot roll is separate (#238).
function grantXp(
	sa: ServerAvatar,
	monster: EntityType,
	zoneId: string,
): ServerAvatar {
	// Logs are already trimmed to the last 5 by resolveAvatarIntent; accumulate
	// this tick's messages without re-trimming so the order matches single-player.
	const ap = applyXp(sa.progress, xpForKill(monster, zoneId));
	const log = [...sa.log];
	let avatar = sa.avatar;
	if (ap.leveled > 0) {
		const mhp = maxHpForLevel(ap.progress.level);
		avatar = { ...avatar, maxHp: mhp, hp: mhp };
		log.push(`Level up! Now level ${ap.progress.level}.`);
		// Name each Active skill this level-up unlocked (#271) — a multi-level jump lists every rung.
		for (const skill of skillsUnlockedBetween(
			sa.class ?? 'warrior',
			sa.progress.level,
			ap.progress.level,
		))
			log.push(`Unlocked: ${skill.name} [${skill.key}]!`);
	}
	return { ...sa, avatar, progress: ap.progress, log };
}

// Build the in-world Drop: its pickup box is centred on the dead Monster's footprint and
// made a touch wider than a body (LOOT.pickup) so an Avatar grabs it without pixel-hunting.
function spawnDrop(id: number, owner: number, m: Entity, item: Item): Drop {
	return {
		id,
		owner,
		item,
		x: m.x + BOX.w / 2 - LOOT.pickup.w / 2,
		y: m.y + BOX.h - LOOT.pickup.h,
		w: LOOT.pickup.w,
		h: LOOT.pickup.h,
		ttl: LOOT.ttlSec,
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
		// The equipped Weapon joins the broadcast appearance (ADR 0017 §14) so other clients
		// render this Avatar's composited weapon sprite.
		weapon: a.avatar.weapon ?? DEFAULT_WEAPON,
		// Derived from the swing timer against the ONE shared phase machine (ADR 0024), so
		// other clients can render the swing (ADR 0017 §10) — makes the attack visible to others.
		action: actionStateOf(a.avatar),
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
		// Every committer runs the shared phase machine on its `attackT`, so its wind-up
		// telegraph is visible to the Player (ADR 0017 §8/§9/§10). A Staggered Monster surfaces
		// its reaction through the action `flags`.
		action:
			m.type !== 'player'
				? actionStateOf(m)
				: { ...IDLE_ACTION, flags: actionFlags(m) },
	}));
	// Originator-suppression (ADR 0013): an Effect is never sent back to the session that
	// caused it — the acting client already predicted its own blood, so it would double up.
	// `source` is attribution only; strip it from the wire Effect.
	const effects: Effect[] = (state.effects ?? [])
		.filter((e) => e.source !== sessionId)
		.map(({ source: _source, ...e }) => e);
	// Instanced loot is private: stream this recipient only the Drops it owns, so no one
	// sees or chases a rival's pickup (CONTEXT.md, Instanced loot).
	const drops: Drop[] = (state.zone.drops ?? []).filter(
		(d) => d.owner === sessionId,
	);
	return {
		t: 'snapshot',
		tick: state.tick,
		zoneId: state.zone.id,
		avatars,
		monsters,
		projectiles: state.zone.projectiles,
		effects,
		drops,
		progress: me?.progress ?? { level: 1, xp: 0, gold: 0 },
		inventory: me?.inventory ?? [],
		log: me?.log ?? [],
	};
}

// --- Server session helpers -------------------------------------------------

export function createZoneState(zone: Zone): ZoneState {
	return { zone, avatars: [], tick: 0 };
}

// The single cosmetics write both entry points funnel through (ADR 0028): clamp the
// untrusted catalog indices, then stamp them, so the broadcast look and the durable Save
// can't diverge from what the Player picked. The caller persists + rebroadcasts.
export function withCosmetics(
	sa: ServerAvatar,
	cosmetics: Cosmetics,
): ServerAvatar {
	return { ...sa, cosmetics: clampCosmetics(cosmetics) };
}

// Add a freshly-spawned Avatar for a connecting session. The entity id mirrors the
// session id (Avatars are keyed by session on the wire). `restore` seeds durable state
// (#236) — level/XP/Gold, inventory, Weapon, cosmetics, boss flag — but position is never
// persisted, so it always respawns at the safe point.
export function addAvatar(
	state: ZoneState,
	sessionId: number,
	handle: string,
	cosmetics: Cosmetics = DEFAULT_COSMETICS,
	weapon: number = DEFAULT_WEAPON,
	restore?: RestoredAvatar,
): ZoneState {
	const cos = restore?.cosmetics ?? cosmetics;
	const wpn = restore?.equippedWeapon ?? weapon;
	// The chosen Weapon rides the connect handshake (ADR 0017 §14). A restored Avatar
	// spawns at full HP for its saved level (HP is never persisted).
	const avatar: Entity = {
		...spawnAvatar(SPAWN.x, SPAWN.y),
		id: sessionId,
		weapon: wpn,
	};
	if (restore) {
		const mhp = maxHpForLevel(restore.progress.level);
		avatar.maxHp = mhp;
		avatar.hp = mhp;
	}
	// Stamp cosmetics through the shared `withCosmetics` so a fresh spawn is clamped
	// identically to a live `setCosmetics` (ADR 0028).
	const sa: ServerAvatar = withCosmetics(
		{
			sessionId,
			handle,
			// Placeholder: `withCosmetics` overwrites it with the clamped `cos`; only here to
			// satisfy the required field.
			cosmetics: cos,
			avatar,
			progress: restore?.progress ?? { level: 1, xp: 0, gold: 0 },
			inventory: restore?.inventory ?? [],
			log: ['Welcome. Hunt the chasers (j attack, k guard).'],
			nextId: nextItemId(restore?.inventory),
			rngState: sessionId,
			class: 'warrior',
			skillCooldowns: {},
			lastTown: restore?.lastTown,
			bossDefeated: restore?.bossDefeated,
		},
		cos,
	);
	return { ...state, avatars: [...state.avatars, sa] };
}

// The next free looted-Item id: one past the highest the restored inventory holds, so
// fresh loot never collides with a saved Item.
function nextItemId(inventory: Item[] | undefined): number {
	if (!inventory || inventory.length === 0) return 1;
	return inventory.reduce((n, it) => Math.max(n, it.id), 0) + 1;
}

// Remove a session's Avatar on socket close.
export function removeAvatar(state: ZoneState, sessionId: number): ZoneState {
	return {
		...state,
		avatars: state.avatars.filter((a) => a.sessionId !== sessionId),
	};
}
