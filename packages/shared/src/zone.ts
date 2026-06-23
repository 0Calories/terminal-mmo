// The server-authoritative Zone simulation and the client-local Avatar
// prediction step (ADR 0006). Splitting the old single-Avatar `step` into these
// two pure functions is the M2 refactor: the server advances Monsters /
// Projectiles and owns every consequence (Avatar HP, death/respawn, loot, XP,
// Gold) for N reported Avatars; the client predicts only its own Avatar's
// platformer physics. Both live here, framework-free and deterministic, so the
// two sides can never diverge.

import {
	aabbOverlap,
	bloodEffect,
	deathGoreEffect,
	entityBox,
	hurtBloodEffect,
	meleeHitbox,
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
import { stepEntity } from './physics';
import { spawnAvatar } from './player';
import { applyXp, maxHpForLevel } from './progression';
import { projectileBox, spawnProjectile, stepProjectile } from './projectile';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from './protocol';
import {
	type PlayerClass,
	skillForSlot,
	skillHitbox,
	skillUnlocked,
} from './skills';
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
	facing: Facing;
	onGround: boolean;
	attack: boolean;
	interact?: boolean; // request a Portal transition; resolved by the world layer
	skill?: number;
}

/**
 * Thin client-local prediction of the own Avatar: the shared platformer physics
 * plus local cooldown decay, so movement and the swing telegraph feel instant
 * between ~20 Hz snapshots. The server still owns the authoritative result.
 */
export function clientStepAvatar(
	t: Terrain,
	avatar: Entity,
	ctl: Control,
	dtMs: number,
): Entity {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const e = stepEntity(t, avatar, ctl, dt).e;
	e.attackT = Math.max(0, e.attackT - dt);
	e.hurtT = Math.max(0, e.hurtT - dt);
	return e;
}

// The melee/skill hitbox an Avatar projects this tick, if any, plus the mutated
// avatar (attack cooldown / skill cooldowns applied) and log additions.
function resolveAvatarIntent(
	src: ServerAvatar,
	intent: AvatarIntent,
	dt: number,
): { sa: ServerAvatar; hb: Box | null; damage: number } {
	// Trust the client's reported kinematics; keep the server-owned vitals.
	let avatar: Entity = {
		...src.avatar,
		x: intent.x,
		y: intent.y,
		vx: intent.vx,
		vy: intent.vy,
		facing: intent.facing,
		onGround: intent.onGround,
	};
	avatar.attackT = Math.max(0, avatar.attackT - dt);
	avatar.hurtT = Math.max(0, avatar.hurtT - dt);

	const log = src.log.slice(-5);

	// A basic swing and a Skill share one hitbox slot; a fired Skill overrides.
	const attacking = intent.attack && avatar.attackT <= 0;
	if (attacking) avatar = { ...avatar, attackT: COMBAT.attackCooldown };
	let hb: Box | null = attacking ? meleeHitbox(avatar) : null;
	let damage: number = COMBAT.meleeDamage;

	const skillCooldowns: Record<string, number> = {};
	for (const [id, cd] of Object.entries(src.skillCooldowns ?? {}))
		skillCooldowns[id] = Math.max(0, cd - dt);
	if (intent.skill) {
		const skill = skillForSlot(src.class ?? 'warrior', intent.skill);
		if (
			skill &&
			skillUnlocked(skill, src.progress.level) &&
			(skillCooldowns[skill.id] ?? 0) <= 0
		) {
			skillCooldowns[skill.id] = skill.cooldown;
			hb = skillHitbox(avatar, skill);
			damage = skill.damage;
			log.push(`${skill.name}!`);
		}
	}

	return { sa: { ...src, avatar, log, skillCooldowns }, hb, damage };
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
		if (!intent) {
			// No report this tick: hold position, decay timers, project no hitbox.
			const avatar = {
				...src.avatar,
				attackT: Math.max(0, src.avatar.attackT - dt),
				hurtT: Math.max(0, src.avatar.hurtT - dt),
			};
			hitboxes.push(null);
			damages.push(0);
			return { ...src, avatar, log: src.log.slice(-5) };
		}
		const { sa, hb, damage } = resolveAvatarIntent(src, intent, dt);
		hitboxes.push(hb);
		damages.push(damage);
		return sa;
	});

	const effects: Effect[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];

	const monsters: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		m.attackT = Math.max(0, m.attackT - dt);

		const target = nearestAvatar(avatars, m.x);
		const dx = target >= 0 ? avatars[target].avatar.x - m.x : 0;
		const adx = Math.abs(dx);
		const engaged = target >= 0 && m.type === 'shooter' && adx < SHOOTER.aggro;
		let moveX: -1 | 0 | 1;
		if (target >= 0 && m.type === 'chaser' && adx < MONSTER.chaserAggro)
			// hold (moveX 0) inside the deadzone so facing doesn't flip-flop frame
			// to frame when the Avatar is sitting on top of the chaser
			moveX = adx < MONSTER.chaserDeadzone ? 0 : dx > 0 ? 1 : -1;
		else if (engaged) moveX = adx < SHOOTER.keepDist ? (dx > 0 ? -1 : 1) : 0;
		else moveX = m.facing;
		const res = stepEntity(t, m, { moveX, jump: false }, dt);
		m = res.e;

		// patrol turn-around at walls and platform edges
		if (m.onGround && !engaged) {
			const lead = moveX >= 0 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x);
			const footY = Math.ceil(m.y + BOX.h);
			if (res.hitWall || !isSolid(t, lead, footY))
				m.facing = m.facing === 1 ? -1 : 1;
		}

		if (engaged) {
			const dir: Facing = dx >= 0 ? 1 : -1;
			m.facing = dir;
			if (m.attackT <= 0) {
				fired.push(spawnProjectile(nextProjectileId++, m, dir));
				m = { ...m, attackT: SHOOTER.fireCooldown };
			}
		}

		// First Avatar whose hitbox lands (Monster off i-frames) deals damage and is
		// recorded as a contributor. Credit accumulates on the Monster across ticks
		// so every Player who helped shares in the kill (#37, stories 26/27).
		for (let i = 0; i < avatars.length; i++) {
			const hb = hitboxes[i];
			if (hb && m.hurtT <= 0 && aabbOverlap(hb, entityBox(m))) {
				const sid = avatars[i].sessionId;
				const contributors = m.contributors?.includes(sid)
					? m.contributors
					: [...(m.contributors ?? []), sid];
				m = { ...m, hp: m.hp - damages[i], hurtT: 0.6, contributors };
				// One blood burst at the damage site, biased along the attacker's
				// facing, scaled by the damage dealt (ADR 0013). Emitted only here,
				// inside the i-frame gate, so a blocked/i-framed hit makes no Effect.
				// `source` attributes it to the attacker so the per-recipient snapshot
				// filter can suppress sending it back (the attacker predicts its own).
				effects.push(bloodEffect(m, avatars[i].avatar.facing, damages[i], sid));
				break;
			}
		}

		// Contact damage to each Avatar that is touching a still-living Monster.
		if (m.hp > 0) {
			for (let i = 0; i < avatars.length; i++) {
				const a = avatars[i].avatar;
				if (a.hurtT <= 0 && aabbOverlap(entityBox(a), entityBox(m))) {
					avatars[i] = {
						...avatars[i],
						avatar: {
							...a,
							hp: a.hp - MONSTER.contactDamage,
							hurtT: 0.6,
						},
					};
					// Hurt blood at the Avatar, knocked away from the Monster (0 when
					// they share a column). Server-sourced — no `source` — so the
					// snapshot delivers it to the victim too, in sync with the
					// hurt-flash (ADR 0013, #132). Inside the i-frame gate, so an
					// i-framed Avatar bleeds nothing.
					const dir: -1 | 0 | 1 = a.x === m.x ? 0 : a.x > m.x ? 1 : -1;
					effects.push(hurtBloodEffect(a, dir, MONSTER.contactDamage));
				}
			}
		}

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

	// Append this tick's fresh shots last, so they don't move or hit until next tick.
	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		let consumed = false;
		for (let i = 0; i < avatars.length; i++) {
			const a = avatars[i].avatar;
			if (a.hurtT <= 0 && aabbOverlap(projectileBox(pr), entityBox(a))) {
				avatars[i] = {
					...avatars[i],
					avatar: { ...a, hp: a.hp - pr.damage, hurtT: COMBAT.iframes },
				};
				// Hurt blood at the Avatar, knocked along the projectile's travel
				// (0 for a stationary shot). Server-sourced — no `source` — so the
				// snapshot delivers it to the victim too, in sync with the
				// hurt-flash (ADR 0013, #132). Inside the i-frame gate.
				const dir: -1 | 0 | 1 = pr.vx > 0 ? 1 : pr.vx < 0 ? -1 : 0;
				effects.push(hurtBloodEffect(a, dir, pr.damage));
				consumed = true;
				break;
			}
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
): ZoneState {
	const sa: ServerAvatar = {
		sessionId,
		handle,
		cosmetics,
		avatar: { ...spawnAvatar(SPAWN.x, SPAWN.y), id: sessionId },
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: ['Welcome. Hunt the chasers (j to attack).'],
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
