// The server-authoritative multi-Zone world (#33, #39). The World is *funnelled*, not
// channelled (ADR 0024): each Zone runs exactly one shared simulation, so two online
// Players in the same Zone always co-locate rather than scattering across parallel empty
// instances. Joiners enter the start Zone; Portal entry and a forgiving death (respawn in
// Town) move sessions between Zones.

import { aabbOverlap } from './combat';
import { BOX, TOWN_SPAWN } from './constants';
import { itemLabel } from './loot';
import {
	emptySave,
	type PlayerSave,
	type RestoredAvatar,
	restoredFromSave,
} from './persistence';
import type { ServerMessage } from './protocol';
import type { Box, Cosmetics } from './types';
import { buyItem, STARTER_GOODS, saleValue, sellItem } from './vendor';
import type { Zone, ZoneId } from './world';
import {
	type AvatarIntent,
	addAvatar,
	createZoneState,
	removeAvatar,
	type ServerAvatar,
	snapshotFor,
	stepZone,
	withCosmetics,
	type ZoneState,
} from './zone';

export interface ServerWorld {
	// One shared simulation per shared Zone (Town + Fields), keyed by Zone id. A
	// `dungeon`-type Zone is absent here — it is the instanced kind, living only in
	// `instances` below (funnel, ADR 0024).
	zones: Record<ZoneId, ZoneState>;
	// Live private Dungeon instances (#240), keyed `<zoneId>#<partyLeader>`. Created on
	// entry, torn down when the last occupant leaves, so strangers never share a run.
	instances: Record<string, ZoneState>;
	location: Record<number, ZoneId>; // sessionId -> its current (logical) Zone id
	// sessionId -> the instance id it occupies inside a Dungeon; absent in a shared Zone.
	// Same `location` but different `instanceOf` = separate private runs.
	instanceOf: Record<number, string>;
	// sessionId -> the party leader whose Dungeon run it shares (default: itself): two
	// sessions mapped to the same leader key one shared instance, so a friend can co-locate.
	party: Record<number, number>;
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
		// A Dungeon has no shared simulation — spun up privately per entry (#240).
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

// The party leader whose Dungeon run a session shares — itself unless it joined another's
// party. The key half of an instance id.
function partyLeaderOf(world: ServerWorld, sessionId: number): number {
	return world.party[sessionId] ?? sessionId;
}

// The instance id for a party's private run of a Dungeon Zone: same party + Zone ⇒ same
// key, different party ⇒ different instance.
function instanceKey(zone: ZoneId, leader: number): string {
	return `${zone}#${leader}`;
}

// Step every ZoneState in a record, returning a fresh one — so the shared-Zone pass and
// the private-instance pass run the identical code and can't drift apart.
function mapSims(
	sims: Record<string, ZoneState>,
	step: (zs: ZoneState) => ZoneState,
): Record<string, ZoneState> {
	const out: Record<string, ZoneState> = {};
	for (const [key, zs] of Object.entries(sims)) out[key] = step(zs);
	return out;
}

// Put `member` in `leader`'s party so the two share one private Dungeon instance on entry
// (#240). Idempotent; a member is otherwise its own leader (solo).
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

// The ZoneState a session currently occupies — its private Dungeon instance if it is in
// one, otherwise the shared instance of its Zone.
export function zoneStateOf(
	world: ServerWorld,
	sessionId: number,
): ZoneState | undefined {
	const inst = world.instanceOf[sessionId];
	if (inst !== undefined) return world.instances[inst];
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

// Every session sharing `sessionId`'s current Zone — including itself, so a chat sender
// receives its own line. The primitive for Zone-scoped social broadcast (chat #34,
// emotes #38); empty if the session is not placed.
export function sessionsInZone(
	world: ServerWorld,
	sessionId: number,
): number[] {
	// Inside a Dungeon the "Zone" is the private instance, not the logical id: two runs of
	// `dungeon-01` must never hear each other, so group by instance id.
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
	// A shared Zone: everyone at this logical id who is NOT off in a private instance.
	for (const [sid, zone] of Object.entries(world.location))
		if (zone === here && world.instanceOf[Number(sid)] === undefined)
			out.push(Number(sid));
	return out;
}

// The online session whose handle matches `handle`, world-wide — whisper (#40) crosses
// Zones, unlike chat. Case-insensitive; a duplicated handle resolves to the lowest
// sessionId for a deterministic lookup. Undefined if none matches.
export function sessionByHandle(
	world: ServerWorld,
	handle: string,
): number | undefined {
	const want = handle.toLowerCase();
	let found: number | undefined;
	// Both the shared Zones and every live private Dungeon instance hold placed sessions.
	for (const zs of [
		...Object.values(world.zones),
		...Object.values(world.instances),
	])
		for (const a of zs.avatars)
			if (a.handle.toLowerCase() === want)
				if (found === undefined || a.sessionId < found) found = a.sessionId;
	return found;
}

// The handle a placed session registered at the handshake (its canonical casing), or
// undefined if offline. Attributes a whisper to its sender / echoes the real handle (#40).
export function handleOf(
	world: ServerWorld,
	sessionId: number,
): string | undefined {
	return zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	)?.handle;
}

// The server-authoritative gate for a trade (#267, ADR 0025): does the session's Avatar box
// overlap a vendor NPC. Read off the client-authoritative position (ADR 0001), the same box
// the Portal-interact gate trusts. Merchants live only in a Town.
export function atMerchant(world: ServerWorld, sessionId: number): boolean {
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined) return false;
	const sa = zs.avatars.find((a) => a.sessionId === sessionId);
	if (sa === undefined) return false;
	const box = boxAt(sa.avatar.x, sa.avatar.y);
	return (zs.zone.npcs ?? []).some(
		(n) => n.kind === 'vendor' && aabbOverlap(box, n),
	);
}

// Replace one session's ServerAvatar via `fn` in whichever container it occupies (shared
// Zone or private instance), returning a fresh World. The single write path the economy
// mutations funnel through, so a sell can't edit the wrong instance. No-op if unplaced.
function withAvatar(
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

// A server-validated sell of one Item (#267, ADR 0025). Defensive on every axis: the seller
// must be at a Merchant, the `itemId` in ITS OWN inventory, and the price is re-derived
// (`saleValue`) — the request carries only the id. Any failed check is a silent no-op, so a
// forged request can neither conjure Gold nor delete another Player's Item. Caller persists
// on success.
export function applySell(
	world: ServerWorld,
	sessionId: number,
	itemId: number,
): { world: ServerWorld; sold: boolean } {
	if (!atMerchant(world, sessionId)) return { world, sold: false };
	const zs = zoneStateOf(world, sessionId);
	const sa = zs?.avatars.find((a) => a.sessionId === sessionId);
	if (sa === undefined) return { world, sold: false };
	const item = sa.inventory.find((i) => i.id === itemId);
	if (item === undefined) return { world, sold: false }; // unowned/unknown id
	const { progress, inventory } = sellItem(sa.progress, sa.inventory, itemId);
	const next = withAvatar(world, sessionId, (a) => ({
		...a,
		progress,
		inventory,
		log: [
			...a.log.slice(-5),
			`Sold ${itemLabel(item)} (+${saleValue(item)}g).`,
		],
	}));
	return { world: next, sold: true };
}

// A server-validated buy of one starter good (#273, ADR 0025), the mirror of `applySell`:
// the buyer must be at a Merchant, the `index` a real STARTER_GOODS entry, and the price
// re-derived server-side. `buyItem` refuses when the Player can't afford it, so a forged
// request can't conjure a free Item or push Gold into debt. The minted Item takes the
// Avatar's own `nextId` (advanced so ids never collide with loot). Caller persists on success.
export function applyBuy(
	world: ServerWorld,
	sessionId: number,
	index: number,
): { world: ServerWorld; bought: boolean } {
	if (!atMerchant(world, sessionId)) return { world, bought: false };
	const good = STARTER_GOODS[index];
	if (good === undefined) return { world, bought: false }; // non-purchasable/unknown
	const zs = zoneStateOf(world, sessionId);
	const sa = zs?.avatars.find((a) => a.sessionId === sessionId);
	if (sa === undefined) return { world, bought: false };
	const { progress, inventory, bought } = buyItem(
		sa.progress,
		sa.inventory,
		good,
		sa.nextId,
	);
	if (!bought) return { world, bought: false }; // couldn't afford
	const next = withAvatar(world, sessionId, (a) => ({
		...a,
		progress,
		inventory,
		nextId: a.nextId + 1,
		log: [...a.log.slice(-5), `Bought ${good.base} (−${good.price}g).`],
	}));
	return { world: next, bought: true };
}

// An in-game re-customization (#305, ADR 0028): Cosmetics-only (the Handle is set-once) and
// Town-only, so a look can't change mid-combat — a request from a Field/Dungeon is a silent
// no-op. Applied through the same `withCosmetics` path a fresh spawn uses. Caller persists +
// rebroadcasts.
export function applyCosmetics(
	world: ServerWorld,
	sessionId: number,
	cosmetics: Cosmetics,
): { world: ServerWorld; changed: boolean } {
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined) return { world, changed: false }; // unplaced / pre-spawn
	if (zs.zone.type !== 'town') return { world, changed: false }; // Town-only (#305)
	const sa = zs.avatars.find((a) => a.sessionId === sessionId);
	if (sa === undefined) return { world, changed: false };
	const next = withAvatar(world, sessionId, (a) => withCosmetics(a, cosmetics));
	return { world: next, changed: true };
}

// Spawn a joining session's Avatar and record its membership. A fresh account spawns in the
// start Zone; a returning account (`restore`, #236) drops into its last safe Town — never
// its logged-off position (never persisted) — with its durable progress/inventory/weapon/
// cosmetics seeded. A `lastTown` that no longer exists falls back to the start Zone.
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
	// Anchor `lastTown` to the spawn Zone when it is a Town, so a first flush before any
	// Zone change persists where the Avatar actually stands. A restore carries its own.
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
	// A fresh account (no restore) spawning into a Town records that Town too.
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

// Mint a brand-new account's durable Save and spawn its Avatar into the starting Town
// (#302, ADR 0028). Returning accounts never pass here — they restore an existing Save. The
// caller owns persistence and broadcast. `town` is the default starting Town for a Save with
// no last-Town yet.
export function spawnNewAvatar(
	world: ServerWorld,
	sessionId: number,
	handle: string,
	cosmetics: Cosmetics,
	weapon: number,
	town: ZoneId,
): { world: ServerWorld; save: PlayerSave } {
	// The Save carries the finalised look + Weapon so it survives a restart exactly as a
	// returning account restores.
	const save: PlayerSave = {
		...emptySave(handle, town),
		cosmetics,
		equippedWeapon: weapon,
	};
	// Spawn through the same restore path a returning login uses, so a new and a returning
	// account can never place differently.
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

// Drop a disconnected session from its Zone and the membership maps. A session leaving a
// private Dungeon instance tears that instance down if it was the last occupant (#240).
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
		// Torn down on exit: the last one out closes the run; otherwise a party-mate stays.
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

// The snapshot for one session: the authoritative view of its CURRENT Zone, so the stream
// switches automatically on a Zone change.
export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	// zoneStateOf resolves to the private instance when the session is in one, so the stream
	// is the run it actually occupies, not a stranger's.
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined)
		throw new Error(`session ${sessionId} is not placed in any Zone`);
	return snapshotFor(zs, sessionId);
}

function boxAt(x: number, y: number): Box {
	return { x, y, w: BOX.w, h: BOX.h };
}

// Drop an Avatar into a new Zone at `arrival`, killing momentum (it re-falls onto the
// ground) but preserving every server-owned field (HP, progress, inventory).
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
 * Advance every live simulation one tick, then apply cross-Zone relocations: interact on a
 * Portal transfers to its target, a forgiving death relocates the respawn to Town. A shared
 * destination is the one funnelled instance (ADR 0024); a Dungeon destination spins up — or
 * joins — a PRIVATE per-party instance, torn down when its last occupant leaves (#240).
 */
export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	// Portal detection runs on the reported (pre-step) position. Portals are read off the
	// logical Zone template, so a Dungeon instance uses its Zone's own return Portal.
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

	const location = { ...world.location };
	const instanceOf = { ...world.instanceOf };
	const moves: Move[] = [];

	// Step one simulation with the sessions staying in it. Portal-takers are pulled out
	// first — their transition tick runs no movement or combat — and queued as `moves`.
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

	// Step the shared Zones and the private instances through the identical per-sim pass.
	let zones = mapSims(world.zones, stepSim);
	let instances = mapSims(world.instances, stepSim);

	// A forgiving death: stepZone respawned the Avatar in place; relocate it to Town
	// (which also exits any Dungeon instance it died in).
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

	// Apply relocations in a deterministic order so simultaneous arrivals land
	// consistently.
	moves.sort((a, b) => a.sa.sessionId - b.sa.sessionId);
	for (const m of moves) {
		const moved = reposition(m.sa, m.arrival.x, m.arrival.y);
		const logged = m.log
			? { ...moved, log: [...moved.log.slice(-5), m.log] }
			: moved;
		const destType = world.templates[m.dest].type;
		// Reaching a safe Town updates the durable `lastTown` (#236), so login returns the
		// Avatar to the last Town it actually stood in.
		const withLog =
			destType === 'town' ? { ...logged, lastTown: m.dest } : logged;
		location[m.sa.sessionId] = m.dest;
		if (destType === 'dungeon') {
			// Enter the party's PRIVATE run: reuse the instance keyed by the same party (a
			// friend already inside), else spin a fresh one up (#240).
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

	// Tear down any instance left empty this tick — its last occupant portalled out or
	// died (#240).
	for (const key of Object.keys(instances))
		if (instances[key].avatars.length === 0) delete instances[key];

	return { ...world, zones, instances, location, instanceOf };
}
