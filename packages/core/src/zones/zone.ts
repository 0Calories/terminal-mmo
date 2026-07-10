import {
	aabbOverlap,
	actionFlags,
	actionStateOf,
	type CombatEvent,
	deathEvent,
	entityBox,
	IDLE_ACTION,
	meleeActive,
	meleeHitbox,
	regenPoise,
	resolveHitsOnAvatars,
	resolveHitsOnMonsters,
	SWING_TOTAL,
	stepAvatarCombat,
	swatEvent,
	swingPhase,
} from '../combat/combat';
import { COMBAT } from '../combat/constants';
import {
	projectileBox,
	spawnProjectile,
	stepProjectile,
} from '../combat/projectile';
import {
	type PlayerClass,
	skillForSlot,
	skillsUnlockedBetween,
} from '../combat/skills';
import { DEFAULT_WEAPON, weaponById } from '../combat/weapons';
import { ARCHETYPES, BOX, meleeProfileOf } from '../entities/archetypes';
import { clampCosmetics, DEFAULT_COSMETICS } from '../entities/cosmetics';
import {
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from '../entities/emote';
import { spawnAvatar, spawnMonster } from '../entities/factory';
import type {
	Control,
	Cosmetics,
	Drop,
	Entity,
	EntityType,
	Facing,
	Item,
	PendingRespawn,
	PlayerProgress,
	Projectile,
	Strike,
	Terrain,
} from '../entities/types';
import { LOOT } from '../items/constants';
import {
	itemLabel,
	type LootTable,
	lootTableFor,
	rollDrop,
} from '../items/loot';
import type { RestoredAvatar } from '../persistence/persistence';
import { PHYS } from '../physics/constants';
import { stepEntity } from '../physics/physics';
import { isSolid } from '../physics/terrain';
import { applyXp, maxHpForLevel, xpForKill } from '../progression/progression';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from '../protocol/protocol';
import { RESPAWN, SPAWN } from '../world/constants';
import type { Zone, ZoneId } from '../world/world';

export interface ServerAvatar {
	sessionId: number;
	handle: string;
	cosmetics: Cosmetics;
	avatar: Entity;
	progress: PlayerProgress;
	inventory: Item[];
	log: string[];
	nextId: number;
	rngState: number;
	class?: PlayerClass;
	skillCooldowns?: Record<string, number>;
	lastTown?: ZoneId;
	bossDefeated?: boolean;
}

export interface ZoneState {
	zone: Zone;
	avatars: ServerAvatar[];
	tick: number;
	deaths?: number[];
	events?: CombatEvent[];
}

export interface AvatarIntent {
	sessionId: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	ivx?: number;
	facing: Facing;
	onGround: boolean;
	attack: boolean;
	guard?: boolean;
	interact?: boolean;
	dodge?: boolean;
	skill?: number;
	emote?: string;
}

export function clientStepAvatar(
	t: Terrain,
	avatar: Entity,
	ctl: Control,
	dtMs: number,
): Entity {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const e = stepEntity(t, avatar, ctl, dt).e;
	e.hurtT = Math.max(0, e.hurtT - dt);
	const em = stepEmote(e.emoteId, e.emoteT ?? 0, emoteInterrupted(e), dt);
	e.emoteId = em.emoteId ?? undefined;
	e.emoteT = em.emoteT;
	return e;
}

function resolveAvatarIntent(
	src: ServerAvatar,
	intent: AvatarIntent | undefined,
	dt: number,
): { sa: ServerAvatar; strikes: Strike[] } {
	const avatar: Entity = intent
		? {
				...src.avatar,
				x: intent.x,
				y: intent.y,
				vx: intent.vx,
				vy: intent.vy,
				ivx: intent.ivx ?? src.avatar.ivx,
				facing: intent.facing,
				onGround: intent.onGround,
				skillCooldowns: src.skillCooldowns ?? {},
			}
		: { ...src.avatar, skillCooldowns: src.skillCooldowns ?? {} };

	const log = src.log.slice(-5);
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
	const slotSkill =
		intent?.skill !== undefined ? skillForSlot(cls, intent.skill) : undefined;
	if (
		slotSkill &&
		(folded.skillCooldowns?.[slotSkill.id] ?? 0) >
			(avatar.skillCooldowns?.[slotSkill.id] ?? 0)
	)
		log.push(`${slotSkill.name}!`);

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

export function stepZone(
	state: ZoneState,
	intents: AvatarIntent[],
	dtMs: number,
): ZoneState {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const zone = state.zone;
	const t = zone.terrain;

	const byId = new Map(intents.map((i) => [i.sessionId, i]));
	const { avatars, strikes } = stepAvatars(state, byId, dt);
	const swingHits = new Map<number, Set<number>>(
		avatars.map((a) => [a.avatar.id, new Set(a.avatar.swingHits ?? [])]),
	);

	const events: CombatEvent[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];
	const drops: Drop[] = [...(zone.drops ?? [])];
	let nextDropId = zone.nextDropId ?? 1;
	const lootTable = lootTableFor(zone.id);

	// Strikes against Avatars (Faction 'monsters'): melee committers' active
	// frames plus travelling Projectiles — all land in resolveHitsOnAvatars.
	const hostileStrikes: Strike[] = [];
	const advanced: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		const attackTBefore = m.attackT;
		m.attackT = Math.max(0, m.attackT - dt);
		m.attackCdT = Math.max(0, (m.attackCdT ?? 0) - dt);
		m.stunT = Math.max(0, (m.stunT ?? 0) - dt);
		m.poiseT = Math.max(0, (m.poiseT ?? 0) - dt);
		if ((m.poiseT ?? 0) <= 0) m.poise = regenPoise(m, dt);
		const stunned = (m.stunT ?? 0) > 0;
		const committed = m.type !== 'player' && m.attackT > 0;
		const melee = meleeProfileOf(m.type);

		const target = nearestAvatar(avatars, m.x);
		const dx = target >= 0 ? avatars[target].avatar.x - m.x : 0;
		const adx = Math.abs(dx);
		const engaged =
			!stunned &&
			target >= 0 &&
			m.type === 'shooter' &&
			adx < ARCHETYPES.shooter.ranged.aggro;
		let moveX: -1 | 0 | 1;
		if (stunned || committed) moveX = 0;
		else if (melee && target >= 0 && adx < melee.aggro)
			moveX = adx < melee.deadzone ? 0 : dx > 0 ? 1 : -1;
		else if (engaged)
			moveX = adx < ARCHETYPES.shooter.ranged.keepDist ? (dx > 0 ? -1 : 1) : 0;
		else moveX = m.facing;
		const res = stepEntity(t, m, { moveX, jump: false }, dt);
		m = res.e;

		if (!stunned && !committed && m.onGround && !engaged) {
			const lead = moveX >= 0 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x);
			const footY = Math.ceil(m.y + BOX.h);
			if (res.hitWall || !isSolid(t, lead, footY))
				m.facing = m.facing === 1 ? -1 : 1;
		}

		if (engaged && !committed) m.facing = dx >= 0 ? 1 : -1;
		if (engaged && !committed && (m.attackCdT ?? 0) <= 0 && m.attackT <= 0)
			m = { ...m, attackT: SWING_TOTAL };
		if (
			m.type === 'shooter' &&
			swingPhase(attackTBefore) !== 'active' &&
			meleeActive(m.attackT)
		) {
			fired.push(spawnProjectile(nextProjectileId++, m, m.facing));
			m = { ...m, attackCdT: ARCHETYPES.shooter.ranged.fireCooldown };
		}

		if (
			!stunned &&
			!committed &&
			melee &&
			target >= 0 &&
			adx <= melee.range &&
			(m.attackCdT ?? 0) <= 0
		) {
			m.facing = dx >= 0 ? 1 : -1;
			// A fresh commit is a fresh swing: its dedup ledger starts empty.
			m = {
				...m,
				attackT: SWING_TOTAL,
				attackCdT: melee.commitCd,
				swingHits: [],
			};
		}

		// Project, never apply (ADR 0022/0034): the active frames emit a Strike;
		// resolveHitsOnAvatars owns guard/damage/poise/knockback application.
		if (melee && meleeActive(m.attackT))
			hostileStrikes.push({
				attackerId: m.id,
				attackerKind: 'monster',
				hitbox: meleeHitbox(m),
				damage: melee.damage,
				poiseDamage: melee.poise,
				facing: m.facing,
				faction: 'monsters',
				attackerX: m.x,
				knockback: COMBAT.knockback,
				knockbackUp: COMBAT.knockbackUp,
			});

		advanced.push(m);
	}

	// Projectiles travel; a live Avatar swing swats a shot before it can
	// strike; each survivor projects this tick's body as a Strike.
	const flying: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		const travel: Facing = pr.vx >= 0 ? 1 : -1;
		if (strikes.some((s) => aabbOverlap(s.hitbox, projectileBox(pr)))) {
			events.push(swatEvent(pr, travel === 1 ? -1 : 1));
			continue;
		}
		flying.push(pr);
		hostileStrikes.push({
			attackerId: pr.id,
			attackerKind: 'projectile',
			hitbox: projectileBox(pr),
			damage: pr.damage,
			poiseDamage: pr.poiseDamage,
			facing: travel,
			faction: 'monsters',
			knockback: pr.knockback,
			knockbackUp: pr.knockbackUp,
		});
	}

	// The single resolve pass on Avatars (ADR 0022's guard hub): every hostile
	// Strike lands here, after all projection. A landed projectile Strike is
	// consumed (the shot despawns); melee dedups per swing via the ledger.
	const monsterSwingHits = new Map<number, Set<number>>(
		advanced.map((m) => [m.id, new Set(m.swingHits ?? [])]),
	);
	const hitsOnAvatars = resolveHitsOnAvatars(
		avatars.map((sa) => sa.avatar),
		hostileStrikes,
		monsterSwingHits,
	);
	events.push(...hitsOnAvatars.events);
	for (let i = 0; i < avatars.length; i++)
		avatars[i] = { ...avatars[i], avatar: hitsOnAvatars.avatars[i] };
	const projectiles: Projectile[] = flying.filter(
		(pr) => !hitsOnAvatars.consumed.has(pr.id),
	);
	projectiles.push(...fired);

	const hitsOnMonsters = resolveHitsOnMonsters(advanced, strikes, swingHits);
	events.push(...hitsOnMonsters.events);

	const monsters: Entity[] = [];
	const deadMonsters: Entity[] = [];
	for (const m of hitsOnMonsters.monsters) {
		if (m.hp > 0) {
			// Persist the swing ledger: the active window spans multiple ticks.
			monsters.push({
				...m,
				swingHits: [...(monsterSwingHits.get(m.id) ?? [])],
			});
			continue;
		}
		events.push(deathEvent(m));
		deadMonsters.push(m);
	}

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

	const deathPass = resolveDeaths(avatars, deadMonsters, {
		zoneId: zone.id,
		lootTable,
		nextDropId,
	});
	const resolved = deathPass.avatars;
	respawns.push(...deathPass.respawns);
	events.push(...deathPass.events);
	drops.push(...deathPass.drops);
	nextDropId = deathPass.nextDropId;

	const survivingDrops: Drop[] = [];
	for (const d of drops) {
		const ttl = d.ttl - dt;
		if (ttl <= 0) continue;
		const idx = resolved.findIndex((a) => a.sessionId === d.owner);
		if (idx >= 0 && aabbOverlap(entityBox(resolved[idx].avatar), d)) {
			const sa = resolved[idx];
			resolved[idx] = {
				...sa,
				inventory: [...sa.inventory, d.item],
				log: [...sa.log, `Looted ${itemLabel(d.item)}.`],
			};
			continue;
		}
		survivingDrops.push({ ...d, ttl });
	}

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
		events,
	};
}

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
	events: CombatEvent[];
} {
	const next = avatars.slice();
	const drops: Drop[] = [];
	const respawns: PendingRespawn[] = [];
	let nextDropId = ctx.nextDropId;
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

	const deaths: number[] = [];
	const events: CombatEvent[] = [];
	for (const sa of next) {
		if (sa.avatar.hp <= 0) {
			deaths.push(sa.sessionId);
			events.push(deathEvent(sa.avatar));
		}
	}

	return { avatars: next, drops, nextDropId, respawns, deaths, events };
}

function grantXp(
	sa: ServerAvatar,
	monster: EntityType,
	zoneId: string,
): ServerAvatar {
	const ap = applyXp(sa.progress, xpForKill(monster, zoneId));
	const log = [...sa.log];
	let avatar = sa.avatar;
	if (ap.leveled > 0) {
		const mhp = maxHpForLevel(ap.progress.level);
		avatar = { ...avatar, maxHp: mhp, hp: mhp };
		log.push(`Level up! Now level ${ap.progress.level}.`);
		for (const skill of skillsUnlockedBetween(
			sa.class ?? 'warrior',
			sa.progress.level,
			ap.progress.level,
		))
			log.push(`Unlocked: ${skill.name} [${skill.key}]!`);
	}
	return { ...sa, avatar, progress: ap.progress, log };
}

// `source` is server-internal (used to filter out an avatar's own hit events
// above) and never crosses the wire — strip it before it reaches the client.
function stripSource(e: CombatEvent): CombatEvent {
	if (e.kind !== 'hit') return e;
	const { source: _source, ...rest } = e;
	return rest;
}

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
		weapon: a.avatar.weapon ?? DEFAULT_WEAPON,
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
		action:
			m.type !== 'player'
				? actionStateOf(m)
				: { ...IDLE_ACTION, flags: actionFlags(m) },
	}));
	const events: CombatEvent[] = (state.events ?? [])
		.filter((e) => !(e.kind === 'hit' && e.source === sessionId))
		.map(stripSource);
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
		events,
		drops,
		progress: me?.progress ?? { level: 1, xp: 0, gold: 0 },
		inventory: me?.inventory ?? [],
		log: me?.log ?? [],
	};
}

export function createZoneState(zone: Zone): ZoneState {
	return { zone, avatars: [], tick: 0 };
}

export function withCosmetics(
	sa: ServerAvatar,
	cosmetics: Cosmetics,
): ServerAvatar {
	return { ...sa, cosmetics: clampCosmetics(cosmetics) };
}

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
	const avatar: Entity = spawnAvatar(SPAWN.x, SPAWN.y, {
		id: sessionId,
		weapon: wpn,
	});
	if (restore) {
		const mhp = maxHpForLevel(restore.progress.level);
		avatar.maxHp = mhp;
		avatar.hp = mhp;
	}
	const sa: ServerAvatar = withCosmetics(
		{
			sessionId,
			handle,
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

function nextItemId(inventory: Item[] | undefined): number {
	if (!inventory || inventory.length === 0) return 1;
	return inventory.reduce((n, it) => Math.max(n, it.id), 0) + 1;
}

export function removeAvatar(state: ZoneState, sessionId: number): ZoneState {
	return {
		...state,
		avatars: state.avatars.filter((a) => a.sessionId !== sessionId),
	};
}
