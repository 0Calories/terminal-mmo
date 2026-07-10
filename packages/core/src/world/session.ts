// Session placement in a ZoneState and the snapshot projection: the world's
// business (sessions belong to the whole), kept out of the zone tick so zones/
// stays free of persistence/protocol/progression concerns.

import type { CombatEvent } from '../combat/combat';
import { actionFlags, actionStateOf, IDLE_ACTION } from '../combat/combat';
import { DEFAULT_WEAPON } from '../combat/weapons';
import { clampCosmetics, DEFAULT_COSMETICS } from '../entities/cosmetics';
import { spawnAvatar } from '../entities/factory';
import type { Cosmetics, Drop, Entity, Item } from '../entities/types';
import type { RestoredAvatar } from '../persistence/persistence';
import { maxHpForLevel } from '../progression/progression';
import type {
	AvatarSnapshot,
	MonsterSnapshot,
	ServerMessage,
} from '../protocol/protocol';
import { SPAWN } from '../zones/constants';
import type { ServerAvatar, ZoneState } from '../zones/zone';

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

// `source` is server-internal (used to filter out an avatar's own hit events
// below) and never crosses the wire — strip it before it reaches the client.
function stripSource(e: CombatEvent): CombatEvent {
	if (e.kind !== 'hit') return e;
	const { source: _source, ...rest } = e;
	return rest;
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
