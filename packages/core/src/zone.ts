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
	effects?: Effect[];
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

	const effects: Effect[] = [];
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];
	const drops: Drop[] = [...(zone.drops ?? [])];
	let nextDropId = zone.nextDropId ?? 1;
	const lootTable = lootTableFor(zone.id);

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
			!stunned && target >= 0 && m.type === 'shooter' && adx < SHOOTER.aggro;
		let moveX: -1 | 0 | 1;
		if (stunned || committed) moveX = 0;
		else if (melee && target >= 0 && adx < melee.aggro)
			moveX = adx < melee.deadzone ? 0 : dx > 0 ? 1 : -1;
		else if (engaged) moveX = adx < SHOOTER.keepDist ? (dx > 0 ? -1 : 1) : 0;
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
			m = { ...m, attackCdT: SHOOTER.fireCooldown };
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
			m = { ...m, attackT: SWING_TOTAL, attackCdT: melee.commitCd };
		}

		if (melee && meleeActive(m.attackT)) {
			const hb = meleeHitbox(m);
			for (let i = 0; i < avatars.length; i++) {
				const a = avatars[i].avatar;
				if (!avatarHittable(a) || !aabbOverlap(hb, entityBox(a))) continue;
				const g = resolveGuard(a, m.x, melee.damage);
				const away: -1 | 0 | 1 = a.x === m.x ? 0 : a.x > m.x ? 1 : -1;
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
					na = applyImpulse(
						na,
						COMBAT.knockback * m.facing,
						-COMBAT.knockbackUp,
					);
					na = { ...na, stunT: COMBAT.hitstun };
					effects.push(
						...effectsOf(combatEventAt('break', a, m.facing, melee.damage)),
					);
				} else if (g.result !== 'block') {
					effects.push(
						...effectsOf(combatEventAt('hit', a, away, melee.damage)),
					);
				}
				avatars[i] = { ...avatars[i], avatar: na };
			}
		}

		advanced.push(m);
	}

	const hitsOnMonsters = resolveHitsOnMonsters(advanced, strikes, swingHits);
	effects.push(...hitsOnMonsters.effects);

	const monsters: Entity[] = [];
	const deadMonsters: Entity[] = [];
	for (const m of hitsOnMonsters.monsters) {
		if (m.hp > 0) {
			monsters.push(m);
			continue;
		}
		effects.push(...effectsOf(deathEvent(m)));
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

	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue;
		const travel: -1 | 0 | 1 = pr.vx > 0 ? 1 : pr.vx < 0 ? -1 : 0;

		let consumed = false;
		for (const s of strikes) {
			if (aabbOverlap(s.hitbox, projectileBox(pr))) {
				effects.push(...effectsOf(swatEvent(pr, (-travel || 1) as Facing)));
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		for (let i = 0; i < avatars.length; i++) {
			const a = avatars[i].avatar;
			if (!avatarHittable(a) || !aabbOverlap(projectileBox(pr), entityBox(a)))
				continue;
			const g = resolveGuard(a, a.x - travel, pr.damage);
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
				effects.push(
					...effectsOf(combatEventAt('break', a, travel || 1, pr.damage)),
				);
			} else if (g.result !== 'block') {
				effects.push(...effectsOf(combatEventAt('hit', a, travel, pr.damage)));
			}
			avatars[i] = { ...avatars[i], avatar: na };
			consumed = true;
			break;
		}
		if (!consumed) projectiles.push(pr);
	}
	projectiles.push(...fired);

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
		effects,
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
	effects: Effect[];
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
	const effects: Effect[] = [];
	for (const sa of next) {
		if (sa.avatar.hp <= 0) {
			deaths.push(sa.sessionId);
			effects.push(...effectsOf(deathEvent(sa.avatar)));
		}
	}

	return { avatars: next, drops, nextDropId, respawns, deaths, effects };
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
	const effects: Effect[] = (state.effects ?? [])
		.filter((e) => e.source !== sessionId)
		.map(({ source: _source, ...e }) => e);
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
