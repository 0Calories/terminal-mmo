// The server-authoritative Zone simulation and the client-local Avatar
// prediction step (ADR 0006). Splitting the old single-Avatar `step` into these
// two pure functions is the M2 refactor: the server advances Monsters /
// Projectiles and owns every consequence (Avatar HP, death/respawn, loot, XP,
// Gold) for N reported Avatars; the client predicts only its own Avatar's
// platformer physics. Both live here, framework-free and deterministic, so the
// two sides can never diverge.

import { aabbOverlap, entityBox, meleeHitbox } from './combat';
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

		// First Avatar whose hitbox lands (Monster off i-frames) deals damage and
		// is credited the kill if this brings the Monster down.
		let killer = -1;
		for (let i = 0; i < avatars.length; i++) {
			const hb = hitboxes[i];
			if (hb && m.hurtT <= 0 && aabbOverlap(hb, entityBox(m))) {
				m = { ...m, hp: m.hp - damages[i], hurtT: 0.6 };
				killer = i;
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
				}
			}
		}

		if (m.hp > 0) {
			monsters.push(m);
		} else {
			const credited = killer >= 0 ? killer : 0;
			avatars[credited] = grantKill(avatars[credited]);
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
				consumed = true;
				break;
			}
		}
		if (!consumed) projectiles.push(pr);
	}
	projectiles.push(...fired);

	// Forgiving death: respawn at the safe point, full HP, brief i-frames.
	for (let i = 0; i < avatars.length; i++) {
		const a = avatars[i].avatar;
		if (a.hp <= 0) {
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
	return { zone: newZone, avatars, tick: state.tick + 1 };
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
	return {
		t: 'snapshot',
		tick: state.tick,
		avatars,
		monsters,
		projectiles: state.zone.projectiles,
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
export function addAvatar(state: ZoneState, sessionId: number): ZoneState {
	const sa: ServerAvatar = {
		sessionId,
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
