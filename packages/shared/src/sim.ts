import { aabbOverlap, entityBox } from './combat';
import { PHYS, SPAWN } from './constants';
import { stepEntity } from './physics';
import { type PlayerState, spawnPlayerState } from './player';
import type { Entity, Input } from './types';
import type { World, Zone } from './world';
import { type AvatarIntent, type ServerAvatar, stepZone } from './zone';
import { loadZones } from './zoneContent';

export interface GameState {
	player: PlayerState;
	world: World;
	// Co-present Avatars to draw alongside (networked render only; ADR 0003
	// z-orders them with Monsters, local Avatar on top). Absent offline.
	others?: Entity[];
}

/**
 * Seed a playable World from an explicit set of Zones, spawning the Player in
 * `startId` (falling back to the first Zone for an unknown id). The whole set is
 * kept in the World so portal travel between the Zones works. This is the seam
 * `zone play` uses to boot the offline sim from `.zone` files under edit, sharing
 * one code path with `createGame` so the playtest and the game never diverge.
 */
export function createGameFromZones(
	zones: Zone[],
	startId: string,
	seed = 1,
): GameState {
	const rec: Record<string, Zone> = {};
	for (const z of zones) rec[z.id] = z;
	const start = rec[startId] ?? zones[0];
	const player = spawnPlayerState(start.id, SPAWN.x, SPAWN.y, seed);
	return { player, world: { zones: rec, tick: 0 } };
}

export function createGame(seed = 1): GameState {
	// The data-driven World (ADR 0008): zones are loaded from the authored `.zone`
	// files, not built by a factory. loadZones() returns the start Zone (the Town)
	// first; the Player spawns there at the shared safe point.
	const loaded = loadZones();
	return createGameFromZones(loaded, loaded[0].id, seed);
}

// TODO(M1): portal connecting the Field and Town (#3).

/**
 * Advance the active Zone + the Player one tick. Deterministic given inputs.
 *
 * Single-player is the M2 client/server split applied to one local Avatar: the
 * client-local physics prediction feeds a one-Avatar server-authoritative
 * `stepZone`. Routing both through the same consequence engine is what keeps the
 * offline loop and the networked server from ever diverging (ADR 0006).
 */
export function step(game: GameState, input: Input, dtMs: number): GameState {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const zone = game.world.zones[game.player.zoneId];
	const t = zone.terrain;

	// Portals are a client-local Zone transition (cross-Zone routing over the wire
	// is a later slice); handled before movement/combat so the transition tick
	// runs neither.
	if (input.interact) {
		const here = entityBox(game.player.avatar);
		const portal = zone.portals.find((p) => aabbOverlap(here, p));
		if (portal) {
			const avatar: Entity = {
				...game.player.avatar,
				x: portal.arrival.x,
				y: portal.arrival.y,
				vx: 0,
				vy: 0,
				onGround: false,
			};
			const dest = game.world.zones[portal.target];
			const log = [...game.player.log.slice(-5), `Entered the ${dest.type}.`];
			const player: PlayerState = {
				...game.player,
				avatar,
				zoneId: portal.target,
				log,
			};
			return { player, world: { ...game.world, tick: game.world.tick + 1 } };
		}
	}

	// Predict this Avatar's own platformer physics, then let the Zone resolve every
	// consequence under server authority.
	const predicted = stepEntity(
		t,
		game.player.avatar,
		{ moveX: input.moveX, jump: input.jump },
		dt,
	).e;
	const sa: ServerAvatar = {
		sessionId: game.player.avatar.id,
		handle: '', // offline single-player has no broadcast handle
		avatar: game.player.avatar,
		progress: game.player.progress,
		inventory: game.player.inventory,
		log: game.player.log,
		nextId: game.player.nextId,
		rngState: game.player.rngState,
		class: game.player.class,
		skillCooldowns: game.player.skillCooldowns,
	};
	const intent: AvatarIntent = {
		sessionId: sa.sessionId,
		x: predicted.x,
		y: predicted.y,
		vx: predicted.vx,
		vy: predicted.vy,
		facing: predicted.facing,
		onGround: predicted.onGround,
		attack: input.attack,
		skill: input.skill,
	};
	const next = stepZone(
		{ zone, avatars: [sa], tick: game.world.tick },
		[intent],
		dtMs,
	);
	const out = next.avatars[0];
	const player: PlayerState = {
		avatar: out.avatar,
		progress: out.progress,
		inventory: out.inventory,
		zoneId: game.player.zoneId,
		log: out.log,
		nextId: out.nextId,
		rngState: out.rngState,
		class: out.class,
		skillCooldowns: out.skillCooldowns,
	};
	const world: World = {
		zones: { ...game.world.zones, [zone.id]: next.zone },
		tick: next.tick,
	};
	return { player, world };
}
