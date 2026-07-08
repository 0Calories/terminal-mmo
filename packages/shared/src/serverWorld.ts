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
	// The one shared simulation per shared Zone (Town + Fields), keyed by Zone id.
	// Every such Zone exists from the start and there is exactly one instance of each
	// (funnel, ADR 0024). A `dungeon`-type Zone is deliberately absent here — it is the
	// instanced kind, so it has no shared simulation, only the private `instances` below.
	zones: Record<ZoneId, ZoneState>;
	// Live private Dungeon instances (#240), keyed by an instance id
	// (`<zoneId>#<partyLeader>`). Created on entry from Town — one per player, or one per
	// party — and torn down the moment the last occupant leaves (a Portal out or a
	// forgiving death), so strangers never share a Dungeon run.
	instances: Record<string, ZoneState>;
	location: Record<number, ZoneId>; // sessionId -> its current (logical) Zone id
	// sessionId -> the instance id it occupies, for a session inside a Dungeon. Absent
	// for a session in a shared Zone. Two sessions with the same logical `location`
	// (`dungeon-01`) but different `instanceOf` are in separate private runs.
	instanceOf: Record<number, string>;
	// sessionId -> the party leader whose Dungeon run it shares (default: itself). The one
	// grouping seam that lets a friend co-locate: two sessions mapped to the same leader
	// key one shared instance; everyone else is their own leader, so strangers never meet.
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
		// A Dungeon has no shared simulation — its ZoneStates are spun up privately per
		// entry (#240). Every other Zone runs its one shared instance from the start.
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

// The party leader whose Dungeon run a session shares — itself unless it has joined
// another's party. Deterministic; the key half of an instance id.
function partyLeaderOf(world: ServerWorld, sessionId: number): number {
	return world.party[sessionId] ?? sessionId;
}

// The instance id for a party's private run of a Dungeon Zone. Same party + same Zone ⇒
// same key (they co-locate); a different party keys a different instance (strangers never
// share).
function instanceKey(zone: ZoneId, leader: number): string {
	return `${zone}#${leader}`;
}

// Apply a per-simulation step to every ZoneState in a record, returning a fresh record —
// so the shared-Zone pass and the private-instance pass are literally the same code and
// can never drift apart.
function mapSims(
	sims: Record<string, ZoneState>,
	step: (zs: ZoneState) => ZoneState,
): Record<string, ZoneState> {
	const out: Record<string, ZoneState> = {};
	for (const [key, zs] of Object.entries(sims)) out[key] = step(zs);
	return out;
}

// Put `member` in `leader`'s party so the two share one private Dungeon instance on entry
// (#240) — the minimal "with a friend" seam. Idempotent; a member is otherwise its own
// leader (solo). Pure.
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

// Every session sharing `sessionId`'s current Zone — including itself, so a chat
// sender receives its own line. Empty if the session is not placed. The primitive
// for Zone-scoped social broadcast (chat #34, emotes #38): the server relays a
// chat line to exactly these sockets, so it never crosses into another Zone (AC:
// relayed only to the same Zone).
export function sessionsInZone(
	world: ServerWorld,
	sessionId: number,
): number[] {
	// Inside a Dungeon, the "Zone" is the private instance, not the logical id: two
	// separate runs of `dungeon-01` must never hear each other, so group by instance id.
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

// True when a session's Avatar box overlaps a Merchant (vendor NPC) in the ZoneState it
// occupies — the server-authoritative gate for a trade (#267, ADR 0025). Read off the
// client-reported position on the ServerAvatar (positions are client-authoritative, ADR
// 0001), the same box the Portal-interact gate trusts. Merchants live only in a Town, so a
// session in a Field/Dungeon is never at one.
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

// Replace one session's ServerAvatar via `fn`, in whichever container it occupies (its
// shared Zone or its private Dungeon instance), returning a fresh World. A no-op if the
// session is unplaced. The single write path the economy mutations funnel through, so a
// sell can never edit the wrong instance.
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

// Apply a server-validated sell of one Item for a session (#267, ADR 0025). Server-
// authoritative and defensive on every axis: the seller must be standing at a Merchant, the
// `itemId` must be in ITS OWN inventory, and the credited price is re-derived from the Item
// (`saleValue`) — the client's request carries only the id, never a price. Any failed check
// is a silent no-op (`sold: false`, World unchanged), so a forged/stale request can neither
// conjure Gold nor delete another Player's Item. On success the Item leaves the bag, its
// sale value is credited to Gold, and a log line is appended; the caller persists the
// change (a trade is a significant event). Pure — the whole rule is one testable function.
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

// Apply a server-validated buy of one starter good for a session (#273, ADR 0025). The
// mirror of `applySell` and just as defensive: the buyer must be standing at a Merchant,
// the `index` must name a real entry in the fixed STARTER_GOODS catalog, and the price is
// re-derived from that catalog server-side — the client's request carries only the index,
// never a price. `buyItem` refuses when the Player can't afford it, so a forged/stale
// request can neither conjure an Item for free nor push Gold into debt; any failed check is
// a silent no-op (`bought: false`, World unchanged). On success the price is deducted, a
// fresh affix-free `common` Item minted with the Avatar's own id source (`nextId`, then
// advanced so ids never collide with loot) is appended, and a log line recorded; the caller
// persists the change (a trade is a significant event). Pure — the whole rule is one
// testable function.
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

// Apply an in-game re-customization for a session (#305, ADR 0028). Cosmetics-only — the
// Handle is set-once at creation and never touched here. Town-only, mirroring the "Towns are
// where you show off avatars" rule: a request from a Field/Dungeon is a silent no-op
// (`changed: false`, World unchanged), so it can never change a look mid-combat. On success
// the new Cosmetics are stamped onto the live Avatar through the SAME `withCosmetics` path a
// fresh spawn uses (one apply mechanism, two entry points) — the next snapshot rebroadcasts
// the appearance to the Zone and the caller persists it (a significant durable event). Pure —
// the whole rule is one testable function; the caller owns store + broadcast.
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

// Spawn a joining session's Avatar and record its membership. A fresh account spawns in
// the shared start Zone; a returning account (with `restore` from persistence, #236) is
// dropped into its last safe Town — never its logged-off position, which is never
// persisted — and its durable level/XP/Gold, inventory, equipped Weapon, cosmetics, and
// boss-defeated flag are seeded onto the Avatar. A restored `lastTown` that no longer
// exists (a removed/renamed Zone) falls back to the start Zone.
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
	// The Town to anchor `lastTown` to at spawn: the spawn Zone itself when it is a Town, so
	// a first flush before any Zone change persists the Town the Avatar actually stands in
	// (not a fallback constant). A restore already carries its own `lastTown`.
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

// Mint a brand-new account's durable Save from its finalised creator choice and spawn its
// Avatar into the starting Town (#302, ADR 0028). This is the ONE seam a new account's
// first entry funnels through: the server calls it on `createAvatar`, persists the returned
// Save, adds the session to its socket set, and lets the next snapshot broadcast the freshly
// placed Avatar. Returning accounts never pass here — they restore an existing Save. Pure
// and deterministic (no store, no clock): the caller owns persistence and broadcast. #304
// will thread a typed Handle through here; #305's `setCosmetics` shares the cosmetics-apply
// on an already-live Avatar. `town` is the default starting Town for a Save with no
// last-Town yet — a fresh account has none, so it anchors here.
export function spawnNewAvatar(
	world: ServerWorld,
	sessionId: number,
	handle: string,
	cosmetics: Cosmetics,
	weapon: number,
	town: ZoneId,
): { world: ServerWorld; save: PlayerSave } {
	// The minted Save carries the finalised look + Weapon from the start, so it survives a
	// restart exactly as a returning account would restore.
	const save: PlayerSave = {
		...emptySave(handle, town),
		cosmetics,
		equippedWeapon: weapon,
	};
	// Spawn through the same restore path a returning login uses, so a new account and a
	// returning one can never place differently — the Save is the single source of the look.
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

// The snapshot for one session: the authoritative view of its CURRENT Zone — so
// presence is the whole shared Zone and the stream switches automatically on a
// Zone change.
export function worldSnapshotFor(
	world: ServerWorld,
	sessionId: number,
): Extract<ServerMessage, { t: 'snapshot' }> {
	// zoneStateOf resolves to the private Dungeon instance when the session is in one, so
	// the stream is the run it actually occupies — never a stranger's parallel instance.
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined)
		throw new Error(`session ${sessionId} is not placed in any Zone`);
	return snapshotFor(zs, sessionId);
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
 * Advance every live simulation one tick under server authority, then apply cross-Zone
 * relocations: a session pressing interact on a Portal transfers to the Portal's target,
 * and a forgiving death relocates the respawn to Town. A shared destination (Town/Field)
 * is the one funnelled instance of that Zone (ADR 0024); a Dungeon destination spins up —
 * or joins — a PRIVATE per-party instance, torn down when its last occupant leaves (#240).
 * Deterministic given the prior world, the per-session intents, and dt.
 */
export function stepServerWorld(
	world: ServerWorld,
	intents: AvatarIntent[],
	dtMs: number,
): ServerWorld {
	const byId = new Map(intents.map((i) => [i.sessionId, i]));

	// Portal detection runs on the reported (pre-step) position: overlapping a Portal
	// while pressing interact leaves now. The portals are read off the logical Zone
	// template, so a Dungeon instance uses its Zone's own return Portal.
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

	// Step one simulation (a shared Zone OR a private instance) with the sessions staying
	// in it. Portal-takers are pulled out first so their transition tick runs neither
	// movement nor combat, and queued as `moves`.
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
		// Reaching a safe Town updates the durable `lastTown` (#236) — a significant
		// event, so login returns the Avatar to the last Town it actually stood in.
		const withLog =
			destType === 'town' ? { ...logged, lastTown: m.dest } : logged;
		location[m.sa.sessionId] = m.dest;
		if (destType === 'dungeon') {
			// Enter the party's PRIVATE run: reuse an existing instance keyed by the same
			// party (a friend already inside), else spin a fresh one up. Strangers key
			// different instances, so they never share (#240).
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
	// died (#240). A live instance always holds ≥1 Avatar (the entrant that spun it up).
	for (const key of Object.keys(instances))
		if (instances[key].avatars.length === 0) delete instances[key];

	return { ...world, zones, instances, location, instanceOf };
}
