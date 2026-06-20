// sim.ts — orchestration. Advances the Player within the World's active Zone,
// pure + deterministic given (game, input, dtMs). Game logic lives here and in
// player.ts / world.ts so the client and (M2) server never diverge.

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
import { type PlayerState, spawnPlayerState } from './player';
import { applyXp, maxHpForLevel } from './progression';
import { projectileBox, spawnProjectile, stepProjectile } from './projectile';
import { isSolid } from './terrain';
import type {
	Control,
	Entity,
	Facing,
	Input,
	PendingRespawn,
	Projectile,
} from './types';
import {
	makeFieldZone,
	makeTownZone,
	spawnMonster,
	type World,
	type Zone,
} from './world';

/** The single-player game: the client's Player + the World of Zones. A thin
 * bundle — Player and World stay independent (player.ts / world.ts). */
export interface GameState {
	player: PlayerState;
	world: World;
}

/** A fresh single-player game: the World's Zones (a starter Field + the Town
 * hub), Player spawned in the Field. */
export function createGame(seed = 1): GameState {
	const field = makeFieldZone('field-01');
	const town = makeTownZone('town-01');
	const player = spawnPlayerState(field.id, SPAWN.x, SPAWN.y, seed);
	return {
		player,
		world: { zones: { [field.id]: field, [town.id]: town }, tick: 0 },
	};
}

// TODO(M1): portal connecting the Field and Town (#3).

/** Advance the active Zone + the Player one tick. Deterministic given inputs. */
export function step(game: GameState, input: Input, dtMs: number): GameState {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const zone = game.world.zones[game.player.zoneId];
	const t = zone.terrain;

	// --- avatar movement ---
	const pCtl: Control = { moveX: input.moveX, jump: input.jump };
	let avatar = stepEntity(t, game.player.avatar, pCtl, dt).e;
	avatar.attackT = Math.max(0, avatar.attackT - dt);
	avatar.hurtT = Math.max(0, avatar.hurtT - dt);

	// --- avatar attack (resolved against monsters below) ---
	const attacking = input.attack && avatar.attackT <= 0;
	if (attacking) avatar = { ...avatar, attackT: 0.35 };
	const hb = attacking ? meleeHitbox(avatar) : null;

	// player-side consequences accumulate here
	let progress = game.player.progress;
	let inventory = game.player.inventory;
	const log = game.player.log.slice(-5);
	let nextId = game.player.nextId;
	let rngState = game.player.rngState;

	// projectiles fired by shooters this tick (spawned after they're stepped, so
	// a fresh shot doesn't travel or hit on the same tick it's fired)
	const fired: Projectile[] = [];
	let nextProjectileId = zone.nextProjectileId;

	// respawns scheduled by this tick's deaths; merged with carried-over timers
	// below (so a fresh kill always waits the full delay — cf. projectiles).
	let nextMonsterId = zone.nextMonsterId;
	const respawns: PendingRespawn[] = [];

	// --- monsters ---
	const monsters: Entity[] = [];
	for (const m0 of zone.monsters) {
		let m: Entity = { ...m0 };
		m.hurtT = Math.max(0, m.hurtT - dt);
		m.attackT = Math.max(0, m.attackT - dt);

		// AI: chasers close in when near; shooters keep their distance and fire.
		// Otherwise both patrol in the facing direction.
		const dx = avatar.x - m.x;
		const adx = Math.abs(dx);
		const engaged = m.type === 'shooter' && adx < SHOOTER.aggro;
		let moveX: -1 | 0 | 1;
		if (m.type === 'chaser' && adx < MONSTER.chaserAggro)
			moveX = dx > 0 ? 1 : -1;
		else if (engaged)
			moveX = adx < SHOOTER.keepDist ? (dx > 0 ? -1 : 1) : 0; // back off / hold
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

		// an engaged shooter faces the Avatar and fires on cooldown
		if (engaged) {
			const dir: Facing = dx >= 0 ? 1 : -1;
			m.facing = dir;
			if (m.attackT <= 0) {
				fired.push(spawnProjectile(nextProjectileId++, m, dir));
				m = { ...m, attackT: SHOOTER.fireCooldown };
			}
		}

		// avatar melee → monster
		if (hb && m.hurtT <= 0 && aabbOverlap(hb, entityBox(m))) {
			m = { ...m, hp: m.hp - 8, hurtT: 0.6 };
		}
		// monster contact → avatar
		if (
			m.hp > 0 &&
			avatar.hurtT <= 0 &&
			aabbOverlap(entityBox(avatar), entityBox(m))
		) {
			avatar = { ...avatar, hp: avatar.hp - MONSTER.contactDamage, hurtT: 0.6 };
		}

		if (m.hp > 0) {
			monsters.push(m);
		} else {
			// death → XP (+ level up) and an instanced loot roll into inventory
			const ap = applyXp(progress, XP_PER_KILL);
			progress = ap.progress;
			if (ap.leveled > 0) {
				const mhp = maxHpForLevel(progress.level);
				avatar = { ...avatar, maxHp: mhp, hp: mhp };
				log.push(`Level up! Now level ${progress.level}.`);
			}
			const roll = rollItem(rngState, progress.level);
			rngState = roll.state;
			const item = { ...roll.item, id: nextId++ };
			inventory = [...inventory, item];
			log.push(`Looted ${item.rarity} ${item.base}.`);
			// Field-spawned Monsters respawn at their point after a delay (story 20)
			if (m.spawnIndex !== undefined)
				respawns.push({
					spawnIndex: m.spawnIndex,
					remaining: RESPAWN.delaySec,
				});
		}
	}

	// --- respawn timers --- tick down carried-over timers; due ones spawn a
	// fresh full-HP Monster at its point. Done after the death loop, so this
	// tick's new timers aren't decremented until the next tick.
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

	// --- projectiles --- advance existing shots, resolve Avatar hits, then add
	// this tick's fresh shots (so they don't move or hit until next tick).
	const projectiles: Projectile[] = [];
	for (const pr0 of zone.projectiles) {
		const pr = stepProjectile(t, pr0, dt);
		if (!pr) continue; // despawned on Terrain or lifetime
		if (
			avatar.hurtT <= 0 &&
			aabbOverlap(projectileBox(pr), entityBox(avatar))
		) {
			avatar = { ...avatar, hp: avatar.hp - pr.damage, hurtT: COMBAT.iframes };
			continue; // consumed on hit
		}
		projectiles.push(pr);
	}
	projectiles.push(...fired);

	// forgiving death: respawn at the Field spawn, full HP, brief invulnerability
	if (avatar.hp <= 0) {
		avatar = {
			...avatar,
			hp: avatar.maxHp,
			x: SPAWN.x,
			y: SPAWN.y,
			vx: 0,
			vy: 0,
			hurtT: 1,
		};
		log.push('You fell. Respawned in safety.');
	}

	const player: PlayerState = {
		avatar,
		progress,
		inventory,
		zoneId: game.player.zoneId,
		log,
		nextId,
		rngState,
	};
	const newZone: Zone = {
		...zone,
		monsters,
		projectiles,
		nextProjectileId,
		respawns,
		nextMonsterId,
	};
	const world: World = {
		zones: { ...game.world.zones, [zone.id]: newZone },
		tick: game.world.tick + 1,
	};
	return { player, world };
}
