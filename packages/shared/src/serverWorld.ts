// The server-authoritative multi-Zone world (#33, #39). The server owns which
// Zone each session occupies. The World is *funnelled*, not channelled (ADR 0024):
// each Zone runs exactly one shared simulation, so any two online Players in the
// same Zone always co-locate — never scattered across parallel empty instances.
// Joiners enter the start Zone; Portal entry and a forgiving death (respawn in
// Town) move sessions between Zones. Pure and deterministic — no sockets, no clock
// — so it drives identically under test and over the wire. AOI culling is post-MVP
// (out of scope).

import { aabbOverlap } from './combat';
import { BOX, TOWN_SPAWN } from './constants';
import type { ServerMessage } from './protocol';
import type { Box, Cosmetics } from './types';
import type { Zone, ZoneId } from './world';
import {
	type AvatarIntent,
	addAvatar,
	createZoneState,
	removeAvatar,
	type ServerAvatar,
	snapshotFor,
	stepZone,
	type ZoneState,
} from './zone';

export interface ServerWorld {
	// The one shared simulation per Zone, keyed by Zone id. Every Zone exists from
	// the start and there is exactly one instance of each (funnel, ADR 0024).
	zones: Record<ZoneId, ZoneState>;
	location: Record<number, ZoneId>; // sessionId -> its current Zone
	templates: Record<ZoneId, Zone>; // pristine Zone content
	startZone: ZoneId; // where a joining session spawns
	townZone: ZoneId; // where a forgiving death respawns
}

export function createServerWorld(opts: {
	zones: Zone[];
	start: ZoneId;
	town: ZoneId;
}): ServerWorld {
	const templates: Record<ZoneId, Zone> = {};
	const zones: Record<ZoneId, ZoneState> = {};
	for (const z of opts.zones) {
		templates[z.id] = z;
		zones[z.id] = createZoneState(z);
	}
	return {
		zones,
		location: {},
		templates,
		startZone: opts.start,
		townZone: opts.town,
	};
}

export function zoneOf(
	world: ServerWorld,
	sessionId: number,
): ZoneId | undefined {
	return world.location[sessionId];
}

// The one shared ZoneState a session currently occupies.
export function zoneStateOf(
	world: ServerWorld,
	sessionId: number,
): ZoneState | undefined {
	const zone = world.location[sessionId];
	return zone === undefined ? undefined : world.zones[zone];
}

// The shared ZoneState of a Zone by id (for inspection / tests).
export function zoneInstance(
	world: ServerWorld,
	zone: ZoneId,
): ZoneState | undefined {
	return world.zones[zone];
}

// Every session sharing `sessionId`'s current Zone — including itself, so a chat
// sender receives its own line. Empty if the session is not placed. The primitive
// for Zone-scoped social broadcast (chat #34, emotes #38): the server relays a
// chat line to exactly these sockets, so it never crosses into another Zone (AC:
// relayed only to the same Zone).
export function sessionsInZone(
	world: ServerWorld,
	sessionId: number,
): number[] {
	const here = world.location[sessionId];
	if (here === undefined) return [];
	const out: number[] = [];
	for (const [sid, zone] of Object.entries(world.location))
		if (zone === here) out.push(Number(sid));
	return out;
}

// The online session whose handle matches `handle`, world-wide — the routing
// primitive for whisper (#40), which (unlike chat) crosses Zones. Case-
// insensitive; a duplicated handle resolves to the lowest sessionId so the lookup
// is unambiguous and deterministic. Undefined if no online session matches.
export function sessionByHandle(
	world: ServerWorld,
	handle: string,
): number | undefined {
	const want = handle.toLowerCase();
	let found: number | undefined;
	for (const zs of Object.values(world.zones))
		for (const a of zs.avatars)
			if (a.handle.toLowerCase() === want)
				if (found === undefined || a.sessionId < found) found = a.sessionId;
	return found;
}

// The handle a placed session registered at the handshake (its canonical casing),
// or undefined if the session is not online. Used to attribute a whisper to its
// sender and to echo the recipient's real handle back (#40).
export function handleOf(
	world: ServerWorld,
	sessionId: number,
): string | undefined {
	return zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	)?.handle;
}

// Spawn a joining session's Avatar in the shared start Zone and record its
// membership.
export function addSession(
	world: ServerWorld,
	sessionId: number,
	handle: string,
	cosmetics?: Cosmetics,
	weapon?: number,
): ServerWorld {
	const zone = world.startZone;
	return {
		...world,
		zones: {
			...world.zones,
			[zone]: addAvatar(
				world.zones[zone],
				sessionId,
				handle,
				cosmetics,
				weapon,
			),
		},
		location: { ...world.location, [sessionId]: zone },
	};
}

// Drop a disconnected session from its Zone and the membership map.
export function removeSession(
	world: ServerWorld,
	sessionId: number,
): ServerWorld {
	const zone = world.location[sessionId];
	if (zone === undefined) return world;
	const location = { ...world.location };
	delete location[sessionId];
	return {
		...world,
		zones: {
			...world.zones,
			[zone]: removeAvatar(world.zones[zone], sessionId),
		},
		location,
	};
}

// The snapshot for one session: the authoritative view of its CURRENT Zone — so
// presence is the whole shared Zone and the stream switches automatically on a
// Zone change.
export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	const zone = world.location[sessionId];
	return snapshotFor(world.zones[zone], sessionId);
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
 * target, and a forgiving death relocates the respawn to Town. Each destination is
 * the one shared instance of that Zone (funnel, ADR 0024). Deterministic given the
 * prior world, the per-session intents, and dt.
 */
export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	// Portal detection runs on the reported (pre-step) position: overlapping a
	// Portal while pressing interact leaves now.
	const portalDest = new Map<
		number,
		{ dest: ZoneId; arrival: Move['arrival'] }
	>();
	for (const [sid, zone] of Object.entries(world.location)) {
		const sessionId = Number(sid);
		const intent = byId.get(sessionId);
		if (!intent?.interact) continue;
		const portal = world.templates[zone].portals.find((p) =>
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
	for (const [zone, zs] of Object.entries(world.zones)) {
		const staying: ServerAvatar[] = [];
		for (const a of zs.avatars) {
			const leave = portalDest.get(a.sessionId);
			if (!leave) {
				staying.push(a);
				continue;
			}
			const destType = world.templates[leave.dest].type;
			moves.push({
				sa: a,
				dest: leave.dest,
				arrival: leave.arrival,
				log: `Entered the ${destType}.`,
			});
		}
		const zoneIntents = intents.filter(
			(i) =>
				world.location[i.sessionId] === zone && !portalDest.has(i.sessionId),
		);
		zones[zone] = stepZone({ ...zs, avatars: staying }, zoneIntents, dtMs);
	}

	// A forgiving death: stepZone respawned the Avatar in place; relocate it to Town.
	for (const [zone, zs] of Object.entries(zones)) {
		const dying = new Set(zs.deaths ?? []);
		if (dying.size === 0) continue;
		zones[zone] = {
			...zs,
			avatars: zs.avatars.filter((a) => !dying.has(a.sessionId)),
		};
		for (const a of zs.avatars)
			if (dying.has(a.sessionId))
				moves.push({ sa: a, dest: world.townZone, arrival: TOWN_SPAWN });
	}

	// Apply relocations in a deterministic order so simultaneous arrivals land
	// consistently. Each destination is the single shared instance of that Zone.
	moves.sort((a, b) => a.sa.sessionId - b.sa.sessionId);
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
