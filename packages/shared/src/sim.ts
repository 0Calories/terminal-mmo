import { aabbOverlap, canStartDodge, entityBox } from './combat';
import { COMBAT, PHYS, SPAWN } from './constants';
import { DEFAULT_COSMETICS } from './cosmetics';
import { applyImpulse, stepEntity } from './physics';
import { type PlayerState, spawnPlayerState } from './player';
import { capabilityUnlocked } from './progression';
import type { Effect, Entity, Input } from './types';
import type { World, Zone } from './world';
import { type AvatarIntent, type ServerAvatar, stepZone } from './zone';
import { loadZones } from './zoneContent';

export interface GameState {
	player: PlayerState;
	world: World;
	others?: Entity[];
	effects?: Effect[];
}

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
	// loadZones() returns the start Zone (the Town) first, where the Player spawns.
	const loaded = loadZones();
	return createGameFromZones(loaded, loaded[0].id, seed);
}

// TODO(M1): portal connecting the Field and Town (#3).

export function step(game: GameState, input: Input, dtMs: number): GameState {
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);
	const zone = game.world.zones[game.player.zoneId];
	const t = zone.terrain;

	// Handled before movement/combat so the transition tick runs neither.
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

	// Gate evaluated pre-hop (before the pop ungrounds the body); same decision feeds stepZone's dodge intent.
	let body = game.player.avatar;
	const dodging =
		(input.dodge ?? false) &&
		canStartDodge(body, input.moveX) &&
		capabilityUnlocked('dodge', game.player.progress.level);
	if (dodging)
		body = applyImpulse(
			body,
			input.moveX * COMBAT.dodge.impulse,
			-COMBAT.dodge.up,
		);

	const predicted = stepEntity(
		t,
		body,
		{ moveX: input.moveX, jump: input.jump },
		dt,
	).e;
	const sa: ServerAvatar = {
		sessionId: game.player.avatar.id,
		handle: '',
		cosmetics: DEFAULT_COSMETICS,
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
		// The returned avatar is rebuilt from this intent, so the hop persists across ticks.
		ivx: predicted.ivx,
		facing: predicted.facing,
		onGround: predicted.onGround,
		attack: input.attack,
		dodge: dodging,
		guard: input.guard,
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
	return { player, world, effects: next.effects ?? [] };
}
