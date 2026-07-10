import {
	aabbOverlap,
	type CombatEvent,
	deathEvent,
	entityBox,
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
import { projectileBox, spawnProjectile } from '../combat/projectile';
import { type PlayerClass, skillForSlot } from '../combat/skills';
import { weaponById } from '../combat/weapons';
import { meleeProfileOf, rangedProfileOf } from '../entities/archetypes';
import { BRAINS, type BrainView } from '../entities/brain';
import {
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from '../entities/emote';
import { spawnMonster } from '../entities/factory';
import type {
	Control,
	Cosmetics,
	Drop,
	Entity,
	Facing,
	Item,
	PendingRespawn,
	PlayerProgress,
	Projectile,
	Strike,
	Terrain,
} from '../entities/types';
import { itemLabel, lootTableFor } from '../items/loot';
import { PHYS } from '../physics/constants';
import { IDLE_DRIVE, stepEntity } from '../physics/physics';
import { stepProjectile } from '../physics/projectile';
import { SPAWN } from './constants';
import { resolveDeaths } from './rewards';
import type { Zone, ZoneId } from './types';

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

		// The uniform controller seam (ADR 0034): the Brain decides, the tick
		// executes. All archetype behavior lives in BRAINS + ARCHETYPES; the
		// tick only threads the Brain's private `ai` memory through opaquely.
		const target = nearestAvatar(avatars, m.x);
		const view: BrainView = {
			terrain: t,
			targetX: target >= 0 ? avatars[target].avatar.x : null,
		};
		const { drive, ai } =
			m.type === 'player'
				? { drive: IDLE_DRIVE, ai: m.ai }
				: BRAINS[m.type](m, view);
		m.ai = ai;
		m = stepEntity(t, m, drive, dt).e;

		const melee = meleeProfileOf(m.type);
		if (drive.commit === 'swing' && melee)
			// A fresh commit is a fresh swing: its dedup ledger starts empty.
			m = {
				...m,
				attackT: SWING_TOTAL,
				attackCdT: melee.commitCd,
				swingHits: [],
			};
		else if (drive.commit === 'fire') m = { ...m, attackT: SWING_TOTAL };

		// A ranged archetype releases its shot on the windup→active edge: the
		// wind-up stays a readable cue, and the fire cooldown starts at release.
		const ranged = rangedProfileOf(m.type);
		if (
			ranged &&
			swingPhase(attackTBefore) !== 'active' &&
			meleeActive(m.attackT)
		) {
			fired.push(spawnProjectile(nextProjectileId++, m, m.facing));
			m = { ...m, attackCdT: ranged.fireCooldown };
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

export function createZoneState(zone: Zone): ZoneState {
	return { zone, avatars: [], tick: 0 };
}
