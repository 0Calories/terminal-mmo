import { aabbOverlap } from '../combat/combat';
import { BOX } from '../entities/archetypes';
import type { Box, Cosmetics } from '../entities/types';
import {
	emptySave,
	type PlayerSave,
	type RestoredAvatar,
	restoredFromSave,
} from '../persistence/persistence';
import type { ServerMessage } from '../protocol/protocol';
import type { Zone, ZoneId } from '../zones/types';
import {
	type AvatarIntent,
	createZoneState,
	type ServerAvatar,
	stepZone,
	type ZoneState,
} from '../zones/zone';
import { TOWN_SPAWN } from './constants';
import { addAvatar, removeAvatar, snapshotFor } from './session';

export interface ServerWorld {
	zones: Record<ZoneId, ZoneState>;
	instances: Record<string, ZoneState>;
	location: Record<number, ZoneId>;
	instanceOf: Record<number, string>;
	party: Record<number, number>;
	templates: Record<ZoneId, Zone>;
	startZone: ZoneId;
	townZone: ZoneId;
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
		if (z.type !== 'dungeon') zones[z.id] = createZoneState(z);
	}
	return {
		zones,
		instances: {},
		location: {},
		instanceOf: {},
		party: {},
		templates,
		startZone: opts.start,
		townZone: opts.town,
	};
}

function partyLeaderOf(world: ServerWorld, sessionId: number): number {
	return world.party[sessionId] ?? sessionId;
}

export function instanceKey(zone: ZoneId, leader: number): string {
	return `${zone}#${leader}`;
}

function mapSims(
	sims: Record<string, ZoneState>,
	step: (zs: ZoneState) => ZoneState,
): Record<string, ZoneState> {
	const out: Record<string, ZoneState> = {};
	for (const [key, zs] of Object.entries(sims)) out[key] = step(zs);
	return out;
}

export function joinParty(
	world: ServerWorld,
	member: number,
	leader: number,
): ServerWorld {
	return { ...world, party: { ...world.party, [member]: leader } };
}

export function zoneOf(
	world: ServerWorld,
	sessionId: number,
): ZoneId | undefined {
	return world.location[sessionId];
}

export function zoneStateOf(
	world: ServerWorld,
	sessionId: number,
): ZoneState | undefined {
	const inst = world.instanceOf[sessionId];
	if (inst !== undefined) return world.instances[inst];
	const zone = world.location[sessionId];
	return zone === undefined ? undefined : world.zones[zone];
}

export function zoneInstance(
	world: ServerWorld,
	zone: ZoneId,
): ZoneState | undefined {
	return world.zones[zone];
}

export function sessionsInZone(
	world: ServerWorld,
	sessionId: number,
): number[] {
	const inst = world.instanceOf[sessionId];
	if (inst !== undefined) {
		const out: number[] = [];
		for (const [sid, key] of Object.entries(world.instanceOf))
			if (key === inst) out.push(Number(sid));
		return out;
	}
	const here = world.location[sessionId];
	if (here === undefined) return [];
	const out: number[] = [];
	for (const [sid, zone] of Object.entries(world.location))
		if (zone === here && world.instanceOf[Number(sid)] === undefined)
			out.push(Number(sid));
	return out;
}

export function sessionByHandle(
	world: ServerWorld,
	handle: string,
): number | undefined {
	const want = handle.toLowerCase();
	let found: number | undefined;
	for (const zs of [
		...Object.values(world.zones),
		...Object.values(world.instances),
	])
		for (const a of zs.avatars)
			if (a.handle.toLowerCase() === want)
				if (found === undefined || a.sessionId < found) found = a.sessionId;
	return found;
}

export function handleOf(
	world: ServerWorld,
	sessionId: number,
): string | undefined {
	return zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	)?.handle;
}

export function avatarBox(x: number, y: number): Box {
	return { x, y, w: BOX.w, h: BOX.h };
}

export function updateAvatar(
	world: ServerWorld,
	sessionId: number,
	fn: (sa: ServerAvatar) => ServerAvatar,
): ServerWorld {
	const map = (zs: ZoneState): ZoneState => ({
		...zs,
		avatars: zs.avatars.map((a) => (a.sessionId === sessionId ? fn(a) : a)),
	});
	const inst = world.instanceOf[sessionId];
	if (inst !== undefined)
		return {
			...world,
			instances: { ...world.instances, [inst]: map(world.instances[inst]) },
		};
	const zone = world.location[sessionId];
	if (zone === undefined) return world;
	return {
		...world,
		zones: { ...world.zones, [zone]: map(world.zones[zone]) },
	};
}

export function addSession(
	world: ServerWorld,
	sessionId: number,
	handle: string,
	cosmetics?: Cosmetics,
	weapon?: number,
	restore?: RestoredAvatar,
): ServerWorld {
	const wanted = restore?.lastTown;
	const zone =
		wanted !== undefined && world.zones[wanted] !== undefined
			? wanted
			: world.startZone;
	const spawnTown =
		world.templates[zone].type === 'town' ? zone : restore?.lastTown;
	const seeded = restore
		? { ...restore, lastTown: spawnTown ?? zone }
		: undefined;
	const placed = addAvatar(
		world.zones[zone],
		sessionId,
		handle,
		cosmetics,
		weapon,
		seeded,
	);
	const zoneState =
		seeded || spawnTown === undefined
			? placed
			: {
					...placed,
					avatars: placed.avatars.map((a) =>
						a.sessionId === sessionId ? { ...a, lastTown: spawnTown } : a,
					),
				};
	return {
		...world,
		zones: { ...world.zones, [zone]: zoneState },
		location: { ...world.location, [sessionId]: zone },
	};
}

export function spawnNewAvatar(
	world: ServerWorld,
	sessionId: number,
	handle: string,
	cosmetics: Cosmetics,
	weapon: number,
	town: ZoneId,
): { world: ServerWorld; save: PlayerSave } {
	const save: PlayerSave = {
		...emptySave(handle, town),
		cosmetics,
		equippedWeapon: weapon,
	};
	const next = addSession(
		world,
		sessionId,
		handle,
		cosmetics,
		weapon,
		restoredFromSave(save),
	);
	return { world: next, save };
}

export function removeSession(
	world: ServerWorld,
	sessionId: number,
): ServerWorld {
	const zone = world.location[sessionId];
	if (zone === undefined) return world;
	const location = { ...world.location };
	delete location[sessionId];
	const party = { ...world.party };
	delete party[sessionId];

	const inst = world.instanceOf[sessionId];
	if (inst !== undefined) {
		const instanceOf = { ...world.instanceOf };
		delete instanceOf[sessionId];
		const instances = { ...world.instances };
		const emptied = removeAvatar(instances[inst], sessionId);
		if (emptied.avatars.length === 0) delete instances[inst];
		else instances[inst] = emptied;
		return { ...world, instances, location, instanceOf, party };
	}
	return {
		...world,
		zones: {
			...world.zones,
			[zone]: removeAvatar(world.zones[zone], sessionId),
		},
		location,
		party,
	};
}

export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined)
		throw new Error(`session ${sessionId} is not placed in any Zone`);
	return snapshotFor(zs, sessionId);
}

function reposition(sa: ServerAvatar, x: number, y: number): ServerAvatar {
	return {
		...sa,
		avatar: { ...sa.avatar, x, y, vx: 0, vy: 0, onGround: false },
	};
}

interface Move {
	sa: ServerAvatar;
	dest: ZoneId;
	arrival: { x: number; y: number };
	log?: string;
}

export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	const portalDest = new Map<
		number,
		{ dest: ZoneId; arrival: Move['arrival'] }
	>();
	for (const [sid, zone] of Object.entries(world.location)) {
		const sessionId = Number(sid);
		const intent = byId.get(sessionId);
		if (!intent?.interact) continue;
		const portal = world.templates[zone].portals.find((p) =>
			aabbOverlap(avatarBox(intent.x, intent.y), p),
		);
		if (portal)
			portalDest.set(sessionId, {
				dest: portal.target,
				arrival: portal.arrival,
			});
	}

	const location = { ...world.location };
	const instanceOf = { ...world.instanceOf };
	const moves: Move[] = [];

	const stepSim = (zs: ZoneState): ZoneState => {
		const staying: ServerAvatar[] = [];
		const stayingIds = new Set<number>();
		for (const a of zs.avatars) {
			const leave = portalDest.get(a.sessionId);
			if (leave) {
				moves.push({
					sa: a,
					dest: leave.dest,
					arrival: leave.arrival,
					log: `Entered the ${world.templates[leave.dest].type}.`,
				});
				continue;
			}
			staying.push(a);
			stayingIds.add(a.sessionId);
		}
		const zoneIntents = intents.filter((i) => stayingIds.has(i.sessionId));
		return stepZone({ ...zs, avatars: staying }, zoneIntents, dtMs);
	};

	let zones = mapSims(world.zones, stepSim);
	let instances = mapSims(world.instances, stepSim);

	const reapDeaths = (zs: ZoneState): ZoneState => {
		const dying = new Set(zs.deaths ?? []);
		if (dying.size === 0) return zs;
		for (const a of zs.avatars)
			if (dying.has(a.sessionId))
				moves.push({ sa: a, dest: world.townZone, arrival: TOWN_SPAWN });
		return {
			...zs,
			avatars: zs.avatars.filter((a) => !dying.has(a.sessionId)),
		};
	};
	zones = mapSims(zones, reapDeaths);
	instances = mapSims(instances, reapDeaths);

	moves.sort((a, b) => a.sa.sessionId - b.sa.sessionId);
	for (const m of moves) {
		const moved = reposition(m.sa, m.arrival.x, m.arrival.y);
		const logged = m.log
			? { ...moved, log: [...moved.log.slice(-5), m.log] }
			: moved;
		const destType = world.templates[m.dest].type;
		const withLog =
			destType === 'town' ? { ...logged, lastTown: m.dest } : logged;
		location[m.sa.sessionId] = m.dest;
		if (destType === 'dungeon') {
			const key = instanceKey(m.dest, partyLeaderOf(world, m.sa.sessionId));
			const inst = instances[key] ?? createZoneState(world.templates[m.dest]);
			instances[key] = { ...inst, avatars: [...inst.avatars, withLog] };
			instanceOf[m.sa.sessionId] = key;
		} else {
			const dest = zones[m.dest];
			zones[m.dest] = { ...dest, avatars: [...dest.avatars, withLog] };
			delete instanceOf[m.sa.sessionId];
		}
	}

	for (const key of Object.keys(instances))
		if (instances[key].avatars.length === 0) delete instances[key];

	return { ...world, zones, instances, location, instanceOf };
}
