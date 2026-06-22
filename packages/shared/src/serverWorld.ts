// The server-authoritative multi-Zone world (#33, #39). The server owns which
// Zone *and Channel* each session occupies. A Zone is split into parallel
// Channels under load (ADR 0001): the server fills one Channel up to a soft
// population cap, then opens a fresh one for further entrants — the Player never
// chooses (story 33). Each (Zone, Channel) runs its own independent simulation;
// a client only ever receives snapshots for its own Channel, so Players in
// different Channels of one Zone never see each other. Joiners enter the start
// Zone; Portal entry and a forgiving death (respawn in Town) move sessions
// between Zones, re-routing into a Channel of the destination. Pure and
// deterministic — no sockets, no clock — so it drives identically under test and
// over the wire. Drain/consolidation and AOI culling are post-MVP (out of scope).

import { aabbOverlap } from './combat';
import { BOX, TOWN_SPAWN } from './constants';
import type { ServerMessage } from './protocol';
import type { Box } from './types';
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

// Which parallel instance of a Zone a session occupies. `channel` is 0-based and
// server-assigned; the Player never selects it (story 33).
export interface ChannelKey {
	zone: ZoneId;
	channel: number;
}

export interface ServerWorld {
	// Every (Zone, Channel) simulation, keyed by channelKey(). Channel 0 of each
	// Zone exists from the start; higher Channels open lazily past the soft cap.
	channels: Record<string, ZoneState>;
	location: Record<number, ChannelKey>; // sessionId -> its current (Zone, Channel)
	templates: Record<ZoneId, Zone>; // pristine Zone content; a fresh Channel clones this
	startZone: ZoneId; // where a joining session spawns
	townZone: ZoneId; // where a forgiving death respawns
	cap: number; // soft population cap before a fresh Channel opens
}

// The map key for one Channel of a Zone.
function channelKey(zone: ZoneId, channel: number): string {
	return `${zone}#${channel}`;
}

export function createServerWorld(opts: {
	zones: Zone[];
	start: ZoneId;
	town: ZoneId;
	cap: number;
}): ServerWorld {
	const templates: Record<ZoneId, Zone> = {};
	const channels: Record<string, ZoneState> = {};
	for (const z of opts.zones) {
		templates[z.id] = z;
		channels[channelKey(z.id, 0)] = createZoneState(z);
	}
	return {
		channels,
		location: {},
		templates,
		startZone: opts.start,
		townZone: opts.town,
		cap: opts.cap,
	};
}

export function zoneOf(
	world: ServerWorld,
	sessionId: number,
): ZoneId | undefined {
	return world.location[sessionId]?.zone;
}

export function channelOf(
	world: ServerWorld,
	sessionId: number,
): number | undefined {
	return world.location[sessionId]?.channel;
}

// The ZoneState (one Channel) a session currently occupies.
export function zoneStateOf(
	world: ServerWorld,
	sessionId: number,
): ZoneState | undefined {
	const loc = world.location[sessionId];
	return loc && world.channels[channelKey(loc.zone, loc.channel)];
}

// Every session sharing `sessionId`'s current (Zone, Channel) — including itself,
// so a chat sender receives its own line. Empty if the session is not placed.
// The primitive for Channel-scoped social broadcast (chat #34, emotes #38): the
// server relays a chat line to exactly these sockets, so it never crosses into
// another Channel or Zone (AC: relayed only to the same Zone + Channel).
export function sessionsInChannel(
	world: ServerWorld,
	sessionId: number,
): number[] {
	const here = world.location[sessionId];
	if (!here) return [];
	const out: number[] = [];
	for (const [sid, loc] of Object.entries(world.location))
		if (loc.zone === here.zone && loc.channel === here.channel)
			out.push(Number(sid));
	return out;
}

// The online session whose handle matches `handle`, world-wide — the routing
// primitive for whisper (#40), which (unlike chat) crosses Zones and Channels.
// Case-insensitive; a duplicated handle resolves to the lowest sessionId so the
// lookup is unambiguous and deterministic. Undefined if no online session matches.
export function sessionByHandle(
	world: ServerWorld,
	handle: string,
): number | undefined {
	const want = handle.toLowerCase();
	let found: number | undefined;
	for (const zs of Object.values(world.channels))
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
	const loc = world.location[sessionId];
	if (!loc) return undefined;
	return world.channels[channelKey(loc.zone, loc.channel)]?.avatars.find(
		(a) => a.sessionId === sessionId,
	)?.handle;
}

// Every Channel of a Zone, ordered by Channel index (for inspection / tests).
export function channelsOf(world: ServerWorld, zone: ZoneId): ZoneState[] {
	const out: ZoneState[] = [];
	for (let channel = 0; ; channel++) {
		const zs = world.channels[channelKey(zone, channel)];
		if (!zs) return out;
		out.push(zs);
	}
}

/**
 * The Channel a new entrant to `zone` joins: the lowest-indexed existing Channel
 * with room under the soft cap, else a freshly opened empty Channel (appended to
 * `channels`). Backfilling the lowest Channel with room is intentional and
 * deterministic; draining a near-empty Channel is post-MVP. Mutates `channels`
 * only to add the new Channel; returns the chosen Channel index.
 */
function openRoute(
	channels: Record<string, ZoneState>,
	templates: Record<ZoneId, Zone>,
	cap: number,
	zone: ZoneId,
): number {
	for (let channel = 0; ; channel++) {
		const key = channelKey(zone, channel);
		const zs = channels[key];
		if (!zs) {
			channels[key] = createZoneState(templates[zone]);
			return channel;
		}
		if (zs.avatars.length < cap) return channel;
	}
}

// Spawn a joining session's Avatar in a routed Channel of the start Zone and
// record its membership.
export function addSession(
	world: ServerWorld,
	sessionId: number,
	handle: string,
): ServerWorld {
	const channels = { ...world.channels };
	const channel = openRoute(
		channels,
		world.templates,
		world.cap,
		world.startZone,
	);
	const key = channelKey(world.startZone, channel);
	channels[key] = addAvatar(channels[key], sessionId, handle);
	return {
		...world,
		channels,
		location: {
			...world.location,
			[sessionId]: { zone: world.startZone, channel },
		},
	};
}

// Drop a disconnected session from its Channel and the membership map. The
// now-possibly-empty Channel is left in place (drain/consolidation is post-MVP).
export function removeSession(
	world: ServerWorld,
	sessionId: number,
): ServerWorld {
	const loc = world.location[sessionId];
	if (loc === undefined) return world;
	const key = channelKey(loc.zone, loc.channel);
	const location = { ...world.location };
	delete location[sessionId];
	return {
		...world,
		channels: {
			...world.channels,
			[key]: removeAvatar(world.channels[key], sessionId),
		},
		location,
	};
}

// The snapshot for one session: the authoritative view of its CURRENT Channel
// only — so presence is scoped to the Channel (Players in other Channels of the
// same Zone are absent) and the stream switches automatically on a Zone change.
export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	const loc = world.location[sessionId];
	return snapshotFor(
		world.channels[channelKey(loc.zone, loc.channel)],
		sessionId,
	);
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
 * Advance every Channel one tick under server authority, then apply cross-Zone
 * relocations: a session pressing interact on a Portal transfers to the Portal's
 * target, and a forgiving death relocates the respawn to Town. Each relocation
 * is re-routed into a Channel of the destination Zone (fill to the soft cap, then
 * open a new Channel). Deterministic given the prior world, the per-session
 * intents, and dt.
 */
export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	// Portal detection runs on the reported (pre-step) position, scoped to the
	// session's current Channel: overlapping a Portal while pressing interact
	// leaves now. Portals are static content, identical across a Zone's Channels.
	const portalDest = new Map<
		number,
		{ dest: ZoneId; arrival: Move['arrival'] }
	>();
	for (const [sid, loc] of Object.entries(world.location)) {
		const sessionId = Number(sid);
		const intent = byId.get(sessionId);
		if (!intent?.interact) continue;
		const portal = world.templates[loc.zone].portals.find((p) =>
			aabbOverlap(boxAt(intent.x, intent.y), p),
		);
		if (portal)
			portalDest.set(sessionId, {
				dest: portal.target,
				arrival: portal.arrival,
			});
	}

	const channels: Record<string, ZoneState> = {};
	const location = { ...world.location };
	const moves: Move[] = [];

	// Step each Channel with the sessions staying in it. Portal-takers are pulled
	// out first so their transition tick runs neither movement nor combat.
	for (const [key, zs] of Object.entries(world.channels)) {
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
		const zoneIntents = intents.filter((i) => {
			const l = world.location[i.sessionId];
			return (
				l !== undefined &&
				channelKey(l.zone, l.channel) === key &&
				!portalDest.has(i.sessionId)
			);
		});
		channels[key] = stepZone({ ...zs, avatars: staying }, zoneIntents, dtMs);
	}

	// A forgiving death: stepZone respawned the Avatar in place; relocate it to Town.
	for (const [key, zs] of Object.entries(channels)) {
		const dying = new Set(zs.deaths ?? []);
		if (dying.size === 0) continue;
		channels[key] = {
			...zs,
			avatars: zs.avatars.filter((a) => !dying.has(a.sessionId)),
		};
		for (const a of zs.avatars)
			if (dying.has(a.sessionId))
				moves.push({ sa: a, dest: world.townZone, arrival: TOWN_SPAWN });
	}

	// Apply relocations in a deterministic order so simultaneous arrivals route
	// into Channels consistently (the running population is updated per move).
	moves.sort((a, b) => a.sa.sessionId - b.sa.sessionId);
	for (const m of moves) {
		const channel = openRoute(channels, world.templates, world.cap, m.dest);
		const key = channelKey(m.dest, channel);
		const moved = reposition(m.sa, m.arrival.x, m.arrival.y);
		const withLog = m.log
			? { ...moved, log: [...moved.log.slice(-5), m.log] }
			: moved;
		const dest = channels[key];
		channels[key] = { ...dest, avatars: [...dest.avatars, withLog] };
		location[m.sa.sessionId] = { zone: m.dest, channel };
	}

	return { ...world, channels, location };
}
