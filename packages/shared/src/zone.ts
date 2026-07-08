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
	// The last safe Town this Avatar stood in (#236): tracked as it enters a Town Zone and
	// persisted, so login returns it here rather than to its logged-off position. Absent
	// until first placed. Never on the wire — a server-owned, durable bookkeeping field.
	lastTown?: ZoneId;
	// Boss-defeated flag (#236, plumbing only): the durable "you have completed the demo"
	// bit, persisted per account. Absent == false; the Boss epic wires the trigger that
	// sets it. Server-owned; never replicated.
	bossDefeated?: boolean;
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
	// A freshly-triggered body emote this tick (ADR 0020 §9): the `/em <id>` the Player
	// typed, set on the avatar as `emoteId`/`emoteT` and replicated through the action-
	// state. A one-shot edge — present only on the tick the trigger arrives, not every
	// input — so it doesn't re-fire while held. An unknown id is dropped.
	emote?: string;
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
	// Predict the local Avatar's active emote the same way the server advances it (ADR
	// 0020 §9): count the oneshot down and cancel it the instant we move/fight, so the
	// owner sees its own `/em wave` immediately and walking cancels it with no round-trip.
	// The trigger itself is applied where the chat command is parsed (index.ts).
	const em = stepEmote(e.emoteId, e.emoteT ?? 0, emoteInterrupted(e), dt);
	e.emoteId = em.emoteId ?? undefined;
	e.emoteT = em.emoteT;
	return e;
}

// Server-only adapter over the shared per-Avatar fold `stepAvatarCombat` (combat.ts,
// ADR 0022): trusts the client kinematics, runs the SAME fold the networked client
// predicts with, then layers the server-owned vitals advance (hurtT decay), the body
// emote step, and the skill-name log append the prediction has no use for. Returns the
// Strikes the Avatar projects this tick (usually 0 or 1) for `resolveHitsOnMonsters` to
// apply, plus the folded ServerAvatar. A reported tick runs the live combat Intent; a
// missed report holds position and runs an empty Intent so the same decay still happens
// (attackT AND skill cooldowns), projecting no Strike.
function resolveAvatarIntent(
	src: ServerAvatar,
	intent: AvatarIntent | undefined,
	dt: number,
): { sa: ServerAvatar; strikes: Strike[] } {
	// Trust the client's reported kinematics; keep the server-owned vitals. With
	// no report this tick, hold the prior kinematics in place. Skill cooldowns are
	// seeded onto the entity (ADR 0022 slice 2 settled them there) from the persisted
	// `ServerAvatar.skillCooldowns`, so the shared fold reads and advances them.
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
				skillCooldowns: src.skillCooldowns ?? {},
			}
		: { ...src.avatar, skillCooldowns: src.skillCooldowns ?? {} };

	const log = src.log.slice(-5);
	// The shared per-Avatar combat fold (ADR 0022 slice 1): runs the `resolveCombat`
	// gate and folds the swing/Dodge/Guard/cooldown delta + the `swingHits` reset onto
	// the Avatar. The networked client runs the EXACT same function for its own Avatar,
	// so this fold cannot drift from the prediction. The equipped Weapon contributes
	// only its damage through the gate (ADR 0024 — timing and arc are the one shared
	// moveset) — absent == the default sword. `dodge` is the client's already-gated
	// decision (grounded +
	// moving checked at the impulse site before the hop ungrounds the body, ADR 0017 §5
	// / ADR 0001); the server only re-enforces the tick-stable timing here. `guard`
	// raises the held Guard, resolved authoritatively.
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
	// Body emote (ADR 0020 §9): a fresh `/em` trigger this tick arms the emote (a oneshot
	// seeds its countdown, a loop/hold its elapsed clock at 0), then the shared step
	// advances it and cancels it the instant the Avatar acts (moving / combat / stagger,
	// §6) — evaluated AFTER the swing + guard timers fold above so the cancel reads this
	// tick's resolved state. The owner predicts the identical step client-side.
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
	// The skill-name log (ADR 0022 slice 2): `skillFired` no longer rides the fold's
	// return, so a fire is OBSERVED from the cooldown delta on the entity — the skill for
	// the pressed slot whose cooldown the gate just armed (rose from its pre-fold value).
	// This reads the gate's effect, not its logic, so the unlock/cooldown decision stays
	// single-homed in `resolveCombat`.
	const slotSkill =
		intent?.skill !== undefined ? skillForSlot(cls, intent.skill) : undefined;
	if (
		slotSkill &&
		(folded.skillCooldowns?.[slotSkill.id] ?? 0) >
			(avatar.skillCooldowns?.[slotSkill.id] ?? 0)
	)
		log.push(`${slotSkill.name}!`);

	// Skill cooldowns are now on the entity (the home settled in slice 2); the persisted
	// `ServerAvatar.skillCooldowns` mirrors the same object so the world layer + tests
	// keep reading them off the ServerAvatar.
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

// The project pass over the Avatar set (ADR 0022): fold every Avatar's combat Intent
// through the shared `stepAvatarCombat`, producing the advanced ServerAvatars plus the
// flat `Strike[]` that `resolveHitsOnMonsters` consumes to resolve hits this tick. Each
// Avatar projects 0 or 1 Strikes (a live swing/skill box, else none), carrying its
// `attackerId` so the resolution pass keys both the victim ledger and the Knockback
// Weapon back to the right Avatar. Both the reported and missed-report paths fold
// (attackT AND skill cooldowns decay every tick — a missed report holds position and
// projects no Strike). This is the per-Avatar pipeline stage later slices slot beside.
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
	// Project pass over Avatars (ADR 0022): the shared fold + the flat `Strike[]` that
	// `resolveHitsOnMonsters` consumes. `avatars` is the working set, mutated as the
	// Monster/Projectile loops resolve hits.
	const { avatars, strikes } = stepAvatars(state, byId, dt);
	// Per-swing hit registry as a keyed side-table (ADR 0017 §2 / ADR 0022): `attackerId
	// → Monster ids its current swing has already hit`, seeded from each Avatar's
	// `swingHits` (cleared on a fresh swing by the fold) and read/written by
	// `resolveHitsOnMonsters`, then folded back onto each Avatar at tick end. This — not
	// invulnerability — rate-limits a multi-tick active window to one hit per target, so a
	// Staggered Monster stays hittable by the NEXT swing.
	const swingHits = new Map<number, Set<number>>(
		avatars.map((a) => [a.avatar.id, new Set(a.avatar.swingHits ?? [])]),
	);

	const effects: Effect[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];
	// The Zone's resting Drops carried forward from the prior tick (#238): kills append to
	// this list, the collection pass at tick end grabs the ones underfoot and fades the
	// expired, and the survivors thread back onto the Zone. `nextDropId` sources fresh ids.
	const drops: Drop[] = [...(zone.drops ?? [])];
	let nextDropId = zone.nextDropId ?? 1;
	const lootTable = lootTableFor(zone.id);

	const advanced: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		// The swing timer BEFORE this tick's decay — so the ranged-poker fire below can
		// detect the exact tick the swing crosses into its `active` phase (fire-on-active-
		// entry, the one-shot gate) without a per-monster "has fired" flag.
		const attackTBefore = m.attackT;
		m.attackT = Math.max(0, m.attackT - dt);
		// Ranged-poker fire cadence (ADR 0017 §8): decays toward 0, gating the next commit.
		m.attackCdT = Math.max(0, (m.attackCdT ?? 0) - dt);
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
		// A committer (chaser/brute melee OR shooter ranged poker) that has begun a swing
		// is COMMITTED for the whole wind-up→active→recovery: it neither moves nor
		// re-targets nor re-commits until the swing fully recovers (attackT decays to 0).
		// That commitment is precisely what makes the recovery a punishable opening (ADR
		// 0017 §9): every archetype holds its ground through the telegraph rather than
		// kiting or cancelling.
		const committed = m.type !== 'player' && m.attackT > 0;
		// The melee-committer profile drives the chaser and the brute off one code path
		// (approach → commit → active-phase strike); null for the ranged-poker shooter.
		const melee = meleeProfileOf(m.type);

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
		else if (melee && target >= 0 && adx < melee.aggro)
			// A melee committer (chaser or brute) closes on its target; hold (moveX 0)
			// inside the deadzone so facing doesn't flip-flop frame to frame when the
			// Avatar is sitting on top of it.
			moveX = adx < melee.deadzone ? 0 : dx > 0 ? 1 : -1;
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
		// shot on the tick the swing crosses into its `active` phase, and arms `attackCdT` to
		// pace the next commit — so the Player reads the wind-up, then dodges/blocks/parries
		// the reactable shot or closes in to punish the recovery.
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

		// Melee committer (ADR 0017 §9): the chaser and the brute deal damage ONLY through
		// a telegraphed phased swing — never by contact. When an Avatar is within reach and
		// the committer is free (not staggered, not already mid-swing, and — for the
		// deliberate brute — off its commit cool-down), it COMMITS: it faces the target and
		// loads the full wind-up→active→recovery into `attackT`, and arms `attackCdT` to pace
		// the next commit (0 for the chaser, which re-commits immediately). The wind-up
		// replicates through the action-state (snapshotFor) for the Player to read; the
		// active phase below is the only damaging window; and because `attackT` stays > 0
		// through recovery, the committer cannot re-commit or cancel — that recovery is the
		// Player's punish opening.
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

		// The committer's strike: during its active phase ONLY, project the melee hitbox
		// and apply the universal hit-reaction payload to each overlapping Avatar — the
		// exact same payload a Player's swing carries (ADR 0017 §2), so a committer can
		// Stagger a poise-broken Player. Gated by the victim's i-frames so the multi-tick
		// active window lands once. A break Staggers (Hitstun + a Mass-scaled Knockback
		// impulse); a chip just damages + flinches.
		if (melee && meleeActive(m.attackT)) {
			const hb = meleeHitbox(m);
			for (let i = 0; i < avatars.length; i++) {
				const a = avatars[i].avatar;
				// i-frame gate (ADR 0017 §5): a connect's automatic i-frames OR an active
				// Dodge negate the strike (avatarHittable folds in dodgeInvulnerable).
				// Dodging through the active frames is the demo.
				if (!avatarHittable(a) || !aabbOverlap(hb, entityBox(a))) continue;
				// Resolve the hit against the Avatar's Guard FIRST (ADR 0017 §5): a frontal
				// raise Blocks it (chip + Poise drain), a rear hit ignores Guard. The i-frame
				// (set on every branch) gates the multi-tick active window to one resolution
				// per swing.
				const g = resolveGuard(a, m.x, melee.damage);
				// Direction away from the Monster (0 when they share a column), reused by the
				// hurt-blood bias.
				const away: -1 | 0 | 1 = a.x === m.x ? 0 : a.x > m.x ? 1 : -1;
				// Block (chip + Poise drain → possible guard-break) or an unguarded/rear hit
				// (full payload). resolveGuard already reduced the HP and drained Poise for a
				// Block; for an unguarded hit, apply the full Poise damage here. A guard-break
				// and an unguarded Poise break both Stagger the Avatar through the same path.
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
					// The break resolves to a `break` CombatEvent → its impact via `effectsOf`
					// (ADR 0019). No `source`, so — like a Monster break — it reaches everyone in
					// range including the victim's client (hitstop + camera-kick).
					effects.push(
						...effectsOf(combatEventAt('break', a, m.facing, melee.damage)),
					);
				} else if (g.result !== 'block') {
					// Incoming hurt resolves to a `hit` CombatEvent → blood via `effectsOf` (ADR
					// 0019), biased away from the Monster (0 when they share a column). NO `source`
					// — incoming hurt is never predicted (ADR 0013 §3), so the snapshot delivers it
					// to the victim too, in sync with the hurt-flash. A clean Block emits no blood —
					// the brace soaked it, only the chip + Poise drain show.
					effects.push(
						...effectsOf(combatEventAt('hit', a, away, melee.damage)),
					);
				}
				avatars[i] = { ...avatars[i], avatar: na };
			}
		}

		// Passive contact damage is GONE (ADR 0017 §9): overlapping a Monster does
		// nothing. All Monster melee now flows through the telegraphed active-phase
		// strike above, so every point of incoming damage was dodgeable/punishable.

		advanced.push(m);
	}

	// Resolve Avatar swings → Monsters as the uniform guardless pass (ADR 0022): every
	// player-faction Strike lands on the Monsters it newly strikes, applying the
	// universal hit-reaction (HP + Poise, Stagger + Knockback on a break) off the
	// per-swing `swingHits` side-table — the Avatar-swing direction lifted out of the
	// monster loop and off slice 1's positional hitbox/damage handoff. Monster strikes
	// against Avatars (the Guard hub) and projectile contacts stay on their own paths
	// (slices 3/4). Runs AFTER monster AI so a swing this tick sees post-move Monsters,
	// exactly as the old per-monster interleaving did (the hit always followed the AI).
	const hitsOnMonsters = resolveHitsOnMonsters(advanced, strikes, swingHits);
	effects.push(...hitsOnMonsters.effects);

	// The death *decision* stays at the resolution site (ADR 0019/0022): applying lethal
	// damage is what makes a contact a death. A Monster driven to 0 HP sprays tinted gore
	// here and is collected into the death set; the world-state *consequences* (shared XP
	// + instanced loot to each accumulated contributor, respawn scheduling, removal) defer
	// to `resolveDeaths` below. Removal is implicit — only survivors re-enter `monsters`.
	const monsters: Entity[] = [];
	const deadMonsters: Entity[] = [];
	for (const m of hitsOnMonsters.monsters) {
		if (m.hp > 0) {
			monsters.push(m);
			continue;
		}
		// The kill resolves to a `death` CombatEvent → a radial, high-intensity gore
		// burst tinted to the Monster's body colour, via the shared `effectsOf` (ADR
		// 0013 #139 / ADR 0019). No `source`, so every Player in range — including the
		// killer — sees it.
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

	// Projectiles are first-class hostile hits with a full counterplay set (ADR 0017 §8,
	// ADR 0024). Each surviving shot resolves through the SAME hit path melee does —
	// i-frame gate, Guard, Poise break — so a heavy shot Staggers exactly like a swing.
	// Every shot threatens Avatars and is countered by Dodge, Block, or a melee swat.
	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		// Travel direction, reused as the Knockback push + Effect bias (0 for a
		// stationary shot, e.g. a test fixture).
		const travel: -1 | 0 | 1 = pr.vx > 0 ? 1 : pr.vx < 0 ? -1 : 0;

		// Melee swat (ADR 0017 §8): a Player's live active melee/skill hitbox DESTROYS a
		// hostile shot on contact — the shot is simply gone. Checked before the body hit so
		// a well-timed swing is a valid counter. The live hitboxes are the player-faction
		// Strikes projected this tick (ADR 0022); any one overlapping the shot swats it. The
		// impact burst (no source) gives the clink + camera juice to everyone in range.
		let consumed = false;
		for (const s of strikes) {
			if (aabbOverlap(s.hitbox, projectileBox(pr))) {
				// The swat resolves to a `swat` CombatEvent at the shot → its impact via the
				// shared `effectsOf` (ADR 0019): a light clink (the shot's own damage, no Poise
				// bump — distinct from a break), source-less so the clink + camera juice reach
				// everyone in range. Biased back along the swat (`-travel`).
				effects.push(...effectsOf(swatEvent(pr, (-travel || 1) as Facing)));
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		// Otherwise the shot resolves against an Avatar's body. The i-frame gate
		// (automatic hurtT OR an active Dodge) negates it WITHOUT consuming it, so a
		// Dodge slips it and it flies on (ADR 0017 §5). A frontal Guard then Blocks it
		// (chip + Poise drain); an unguarded/rear hit takes the full payload, Staggering on
		// a Poise break exactly like a melee connect.
		for (let i = 0; i < avatars.length; i++) {
			const a = avatars[i].avatar;
			if (!avatarHittable(a) || !aabbOverlap(projectileBox(pr), entityBox(a)))
				continue;
			// The shot's source is back along its travel; resolveGuard's frontal-arc
			// check needs a point on that side (a stationary shot is treated as frontal).
			const g = resolveGuard(a, a.x - travel, pr.damage);
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
				// The shot's break → a `break` CombatEvent → impact via `effectsOf` (ADR 0019);
				// source-less (hitstop + camera-kick for everyone, the victim included).
				effects.push(
					...effectsOf(combatEventAt('break', a, travel || 1, pr.damage)),
				);
			} else if (g.result !== 'block') {
				// Incoming hurt → a `hit` CombatEvent → blood via `effectsOf`, biased along the
				// shot's travel. NO `source`: incoming hurt is never predicted (ADR 0013 §3), so
				// the snapshot delivers it to the victim too. A clean Block soaked it (no blood,
				// only the chip + Poise drain).
				effects.push(...effectsOf(combatEventAt('hit', a, travel, pr.damage)));
			}
			avatars[i] = { ...avatars[i], avatar: na };
			consumed = true;
			break;
		}
		if (!consumed) projectiles.push(pr);
	}
	projectiles.push(...fired);

	// The death-consequences pass (ADR 0022 slice 5): consume the death set decided during
	// combat resolution above. Monsters pay out fully zone-local (shared XP + instanced-loot
	// Drops to their accumulated contributors, respawn scheduling); Avatars only report the
	// transient died-this-tick set + the fall gore, and their in-place respawn is deferred to
	// AFTER the collection pass below (so a dying contributor still grabs its loot), with the
	// cross-zone Town relocation escalating to `stepServerWorld`. The fresh loot Drops append
	// to this tick's `drops` so collection still hands a live contributor standing on the kill
	// its Drop this tick (#238). Monster respawns join `respawns` AFTER the decrement loop
	// above, so a freshly-scheduled timer waits a full tick.
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

	// Collect + age the in-world Drops (#238). A Drop is PRIVATE to its owner: it is
	// picked up the moment the owner's body box overlaps it — appended to that Avatar's
	// inventory with a pickup log line — and it fades once its ttl drains. Rarity reads by
	// colour on the in-world Drop glyph/label the client paints (this log line is the plain
	// textual record). Runs on the post-combat Avatar positions, BEFORE the death respawn
	// below, so an Avatar (including one that died this tick) grabs loot where it stands, not
	// at the safe point it is about to respawn to.
	const survivingDrops: Drop[] = [];
	for (const d of drops) {
		const ttl = d.ttl - dt;
		if (ttl <= 0) continue; // faded — grab it before it vanishes
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

	// Forgiving respawn for the Avatars `resolveDeaths` reported dead: safe point, full HP,
	// brief i-frames. Deferred to here — after loot collection — so a dying Avatar keeps what
	// it fell on; the world layer then escalates this to a cross-zone Town move.
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
	// in-flight swing keeps the ids it has already hit (read back from the keyed
	// `swingHits` side-table `resolveHitsOnMonsters` wrote) so it can't double-hit them,
	// and the fold clears the list when the next swing starts. Keyed by Avatar id, so it
	// survives `resolveDeaths` returning a fresh Avatar array.
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
 * The death-consequences pass (ADR 0022 slice 5). Consumes the death set decided during
 * combat resolution — `deadMonsters` already had their death CombatEvent → Effect emitted
 * and `contributors` accumulated at the resolution site — and applies the world-state
 * consequences, preserving the monster-local / avatar-escalates asymmetry:
 *   - Monsters: shared XP + instanced loot to each accumulated contributor (#37), and
 *     respawn scheduling — all zone-local. Removal is implicit (the caller only re-collects
 *     survivors). The instanced-loot per-contributor split stays a separate concern; today's
 *     per-Avatar seeded roll leaving an in-world Drop (#238) is wired through as-is.
 *   - Avatars: emit ONLY the transient died-this-tick set (and the fall's death gore). The
 *     forgiving in-place respawn at the safe point is left to the caller so it runs AFTER the
 *     loot-collection pass — a contributor that dies standing on its own fresh Drop still
 *     grabs it before the teleport. Cross-zone respawn into Town escalates a layer up in
 *     `stepServerWorld`, so this pass never reaches across zones — the boundary stays intact.
 * Mirrors the `swingHits` reset/add split: contributor *accumulation* (at the resolution
 * site) is separated from contributor *payout* (here). Pure and headlessly testable; the
 * fresh loot Drops are returned for the caller to fold into its collection pass.
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
	// Monster consequences: every contributor earns full XP (shared, not split) and rolls its
	// own private, per-Player-seeded loot — instanced, so there is no shared pile and no
	// kill-stealing (#37). XP lands immediately; the loot roll, gated by the Zone's drop
	// chance, leaves an in-world Drop at the kill site OWNED by that contributor to walk over.
	// Each grant updates only that Avatar's state.
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

	// Avatar consequences: report the transient died-this-tick set and spray the fall's gore
	// at the death site. The forgiving in-place respawn is left to the caller (it runs after
	// loot collection), and the world layer escalates it to a cross-zone Town move — so this
	// pass reports the death and stays inside the Zone.
	const deaths: number[] = [];
	const effects: Effect[] = [];
	for (const sa of next) {
		if (sa.avatar.hp <= 0) {
			deaths.push(sa.sessionId);
			// The fall resolves to a `death` CombatEvent → a radial gore burst tinted to the
			// Avatar's cosmetic hue, via the shared `effectsOf` (ADR 0013 #139 / ADR 0019),
			// at the fall site — the caller teleports them to the safe point afterwards.
			effects.push(...effectsOf(deathEvent(sa.avatar)));
		}
	}

	return { avatars: next, drops, nextDropId, respawns, deaths, effects };
}

// Award shared kill XP (+ any level-up HP bump) to one contributor. The grant scales with
// the Monster's archetype and the Zone's depth (xpForKill, #266) — a shared, not split,
// full award to every contributor. The loot roll is a separate step (#238): a kill leaves
// an in-world Drop, not a bag insert, so XP and loot no longer travel together.
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
		// Name each Active skill this level-up crossed the unlock rung for (#271), so the
		// Player learns WHAT they gained and its key — a multi-level jump lists every rung.
		for (const skill of skillsUnlockedBetween(
			sa.class ?? 'warrior',
			sa.progress.level,
			ap.progress.level,
		))
			log.push(`Unlocked: ${skill.name} [${skill.key}]!`);
	}
	return { ...sa, avatar, progress: ap.progress, log };
}

// Build the in-world Drop for a rolled Item: its pickup box is centred on the dead
// Monster's footprint (so it lands where the kill happened) and made a touch wider than a
// body (LOOT.pickup) so an Avatar standing on the kill grabs it without pixel-hunting.
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
		// The equipped Weapon index joins the broadcast appearance (ADR 0017 §14), so
		// every other client renders THIS Avatar's composited weapon sprite.
		weapon: a.avatar.weapon ?? DEFAULT_WEAPON,
		// Derived from the Avatar's swing timer against the ONE shared phase machine
		// (ADR 0024 — no per-weapon durations), so every other client can render the
		// swing (ADR 0017 §10) — this is what makes the basic attack visible to others.
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
		// Every committer archetype — the melee chaser, the heavy melee brute, and the
		// ranged-poker shooter — runs the shared phase machine on its `attackT`, so each
		// replicates its real swing action-state and its wind-up telegraph is visible to
		// the Player (ADR 0017 §8/§9/§10). A Staggered Monster surfaces its reaction through
		// the action `flags`.
		action:
			m.type !== 'player'
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
	// Instanced loot is private (CONTEXT.md, Instanced loot): stream this recipient only
	// the Drops it owns, never another Player's — so no one sees or can chase a rival's
	// pickup. Absent Drops (an untouched Zone) resolve to an empty list.
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

// The single cosmetics write both entry points funnel through (#302 new-Avatar spawn via
// `addAvatar`, #305 in-game `setCosmetics`, ADR 0028): clamp the untrusted catalog indices,
// then stamp them on the ServerAvatar so the broadcast look (`snapshotFor` reads
// `sa.cosmetics`) and the durable Save (`saveFromAvatar` reads `sa.cosmetics`) can never
// diverge from what the Player picked. Pure — no store, no clock; the caller persists +
// rebroadcasts.
export function withCosmetics(
	sa: ServerAvatar,
	cosmetics: Cosmetics,
): ServerAvatar {
	return { ...sa, cosmetics: clampCosmetics(cosmetics) };
}

// Add a freshly-spawned Avatar for a connecting session. The entity id mirrors
// the session id (Avatars are identified by session on the wire). An optional
// `restore` seeds durable state loaded from persistence (#236): the returning
// Avatar keeps its level/XP/Gold, inventory, equipped Weapon, cosmetics, and
// boss-defeated flag, but always respawns at the safe spawn point (position is
// never persisted). A fresh account passes no `restore` and starts at level 1.
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
	// The chosen Weapon rides the connect handshake (ADR 0017 §14) and lives on the
	// Avatar entity, where it drives both combat resolution and the broadcast look. A
	// restored Avatar spawns at full HP for its saved level (HP is never persisted).
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
	// Cosmetics are stamped through the shared `withCosmetics` — the ONE apply path both a fresh
	// spawn and in-game re-customization funnel through (ADR 0028) — so the fresh Avatar is
	// clamped identically to a live `setCosmetics`.
	const sa: ServerAvatar = withCosmetics(
		{
			sessionId,
			handle,
			// Placeholder — `withCosmetics` below overwrites it with the clamped `cos`; it exists
			// only to satisfy the required field before the single stamp runs.
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

// The next free looted-Item id for a restored inventory: one past the highest id it
// already holds, so a returning Player's fresh loot never collides with a saved Item.
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
