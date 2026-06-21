// The server-authoritative multi-Zone world (#33). The server owns which Zone
// each session occupies: it places joiners in the start Zone, advances every
// Zone's independent simulation each tick, and moves sessions between Zones on
// Portal entry and on a forgiving death (which respawns in Town). A client only
// ever receives snapshots for its current Zone. Pure and deterministic — no
// sockets, no clock — so it drives identically under test and over the wire.

import { aabbOverlap } from './combat';
import { BOX, TOWN_SPAWN } from './constants';
import type { ServerMessage } from './protocol';
import type { Box } from './types';
import type { ZoneId } from './world';
import {
	type AvatarIntent,
	addAvatar,
	removeAvatar,
	type ServerAvatar,
	snapshotFor,
	stepZone,
	type ZoneState,
} from './zone';

export interface ServerWorld {
	zones: Record<ZoneId, ZoneState>;
	location: Record<number, ZoneId>; // sessionId -> the Zone it currently occupies
	startZone: ZoneId; // where a joining session spawns
	townZone: ZoneId; // where a forgiving death respawns
}

export function createServerWorld(opts: {
	zones: ZoneState[];
	start: ZoneId;
	town: ZoneId;
}): ServerWorld {
	const zones: Record<ZoneId, ZoneState> = {};
	for (const z of opts.zones) zones[z.zone.id] = z;
	return { zones, location: {}, startZone: opts.start, townZone: opts.town };
}

export function zoneOf(
	world: ServerWorld,
	sessionId: number,
): ZoneId | undefined {
	return world.location[sessionId];
}

// Spawn a joining session's Avatar in the start Zone and record its membership.
export function addSession(
	world: ServerWorld,
	sessionId: number,
	handle: string,
): ServerWorld {
	const zoneId = world.startZone;
	return {
		...world,
		zones: {
			...world.zones,
			[zoneId]: addAvatar(world.zones[zoneId], sessionId, handle),
		},
		location: { ...world.location, [sessionId]: zoneId },
	};
}

// Drop a disconnected session from its Zone and the membership map.
export function removeSession(
	world: ServerWorld,
	sessionId: number,
): ServerWorld {
	const zoneId = world.location[sessionId];
	if (zoneId === undefined) return world;
	const location = { ...world.location };
	delete location[sessionId];
	return {
		...world,
		zones: {
			...world.zones,
			[zoneId]: removeAvatar(world.zones[zoneId], sessionId),
		},
		location,
	};
}

// The snapshot for one session: the authoritative view of its CURRENT Zone only
// (so the stream switches automatically when the session changes Zones).
export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	return snapshotFor(world.zones[world.location[sessionId]], sessionId);
}

function boxAt(x: number, y: number): Box {
	return { x, y, w: BOX.w, h: BOX.h };
}

// Drop an Avatar into a new Zone at `arrival`, killing momentum (it re-falls onto
// the ground), preserving every server-owned field (HP, progress, inventory).
function reposition(sa: ServerAvatar, x: number, y: number): ServerAvatar {
	return {
		...sa,
		avatar: { ...sa.avatar, x, y, vx: 0, vy: 0, onGround: false },
	};
}

// A pending cross-Zone relocation (Portal entry or death respawn).
interface Move {
	sa: ServerAvatar;
	dest: ZoneId;
	arrival: { x: number; y: number };
	log?: string;
}

/**
 * Advance every Zone one tick under server authority, then apply cross-Zone
 * relocations: a session pressing interact on a Portal transfers to the Portal's
 * target at its arrival point, and a forgiving death relocates the respawn to
 * Town. Deterministic given the prior world, the per-session intents, and dt.
 */
export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	// Portal detection runs on the reported (pre-step) position: a session whose
	// box overlaps a Portal in its current Zone while pressing interact leaves now.
	const portalDest = new Map<
		number,
		{ dest: ZoneId; arrival: Move['arrival'] }
	>();
	for (const [sid, zoneId] of Object.entries(world.location)) {
		const sessionId = Number(sid);
		const intent = byId.get(sessionId);
		if (!intent?.interact) continue;
		const portal = world.zones[zoneId].zone.portals.find((p) =>
			aabbOverlap(boxAt(intent.x, intent.y), p),
		);
		if (portal)
			portalDest.set(sessionId, {
				dest: portal.target,
				arrival: portal.arrival,
			});
	}

	const zones: Record<ZoneId, ZoneState> = {};
	const location = { ...world.location };
	const moves: Move[] = [];

	// Step each Zone with the sessions staying in it. Portal-takers are pulled out
	// first so their transition tick runs neither movement nor combat.
	for (const [zoneId, zs] of Object.entries(world.zones)) {
		const staying: ServerAvatar[] = [];
		for (const a of zs.avatars) {
			const leave = portalDest.get(a.sessionId);
			if (!leave) {
				staying.push(a);
				continue;
			}
			const destType = world.zones[leave.dest].zone.type;
			moves.push({
				sa: a,
				dest: leave.dest,
				arrival: leave.arrival,
				log: `Entered the ${destType}.`,
			});
		}
		const zoneIntents = intents.filter(
			(i) =>
				world.location[i.sessionId] === zoneId && !portalDest.has(i.sessionId),
		);
		zones[zoneId] = stepZone({ ...zs, avatars: staying }, zoneIntents, dtMs);
	}

	// A forgiving death: stepZone respawned the Avatar in place; relocate it to Town.
	for (const [zoneId, zs] of Object.entries(zones)) {
		const dying = new Set(zs.deaths ?? []);
		if (dying.size === 0) continue;
		zones[zoneId] = {
			...zs,
			avatars: zs.avatars.filter((a) => !dying.has(a.sessionId)),
		};
		for (const a of zs.avatars)
			if (dying.has(a.sessionId))
				moves.push({ sa: a, dest: world.townZone, arrival: TOWN_SPAWN });
	}

	for (const m of moves) {
		const moved = reposition(m.sa, m.arrival.x, m.arrival.y);
		const withLog = m.log
			? { ...moved, log: [...moved.log.slice(-5), m.log] }
			: moved;
		const dest = zones[m.dest];
		zones[m.dest] = { ...dest, avatars: [...dest.avatars, withLog] };
		location[m.sa.sessionId] = m.dest;
	}

	return { ...world, zones, location };
}
