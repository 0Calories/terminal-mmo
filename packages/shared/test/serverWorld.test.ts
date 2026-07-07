import { expect, test } from 'bun:test';
import type { AvatarIntent, Item, Npc, ServerWorld } from '../src';
import {
	addSession,
	applyBuy,
	applySell,
	atMerchant,
	BOX,
	createServerWorld,
	emptySave,
	GROUND_TOP,
	handleOf,
	joinParty,
	loadZones,
	removeSession,
	restoredFromSave,
	STARTER_GOODS,
	saleValue,
	sessionByHandle,
	sessionsInZone,
	stepServerWorld,
	TOWN_SPAWN,
	worldSnapshotFor,
	zoneInstance,
	zoneOf,
	zoneStateOf,
} from '../src';

const y = GROUND_TOP - BOX.h;

// The one shared instance of a Zone (asserts it exists — the funnel guarantees it).
function zoneOrThrow(w: ServerWorld, zone: string) {
	const zs = zoneInstance(w, zone);
	if (!zs) throw new Error(`expected a shared instance of ${zone}`);
	return zs;
}

// A funnelled World: one shared instance of every Zone (ADR 0024, no Channels).
function makeWorld(): ServerWorld {
	return createServerWorld({
		zones: loadZones(),
		start: 'field-01',
		town: 'town-01',
	});
}

// Report the Avatar holding still at (x, y), no combat or portal intent.
function holdAt(sessionId: number, x: number, interact = false): AvatarIntent {
	return {
		sessionId,
		x,
		y,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		interact,
	};
}

test('addSession places a new session in the start Zone with its handle', () => {
	const w = addSession(makeWorld(), 7, 'neo');
	expect(zoneOf(w, 7)).toBe('field-01');
	const here = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(here?.handle).toBe('neo');
	expect(zoneOrThrow(w, 'town-01').avatars.length).toBe(0);
});

test('stepServerWorld advances every Zone each tick', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = stepServerWorld(w, [holdAt(7, 20)], 16);
	expect(zoneOrThrow(w, 'field-01').tick).toBe(1);
	expect(zoneOrThrow(w, 'town-01').tick).toBe(1); // empty Zones still run their own loop
});

test('entering a Portal transfers the session to the target Zone at the arrival point', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const fieldPortal = zoneOrThrow(w, 'field-01').zone.portals[0];
	// Stand on the Field->Town portal and press interact.
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(
		zoneOrThrow(w, 'field-01').avatars.some((a) => a.sessionId === 7),
	).toBe(false);
	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.x).toBe(fieldPortal.arrival.x);
	expect(moved?.avatar.y).toBe(fieldPortal.arrival.y);
});

test('one interact EDGE transfers exactly once and does not ping-pong on the overlapping arrival (ADR 0027)', () => {
	// The Field→Town arrival sits ON the Town's return Portal (#90, left alone), so a
	// *sustained* interact would bounce Field↔Town every tick. Safety therefore rests
	// entirely on interact being a one-shot EDGE: the client latch + server pending-edge
	// queue (index.ts) deliver interact=true for exactly ONE tick, then false. This test
	// models that delivery — true then false — and proves the transfer happens once and
	// the Avatar then stays put, even though it is standing on the return Portal.
	let w = addSession(makeWorld(), 7, 'neo');
	const fieldPortal = zoneOrThrow(w, 'field-01').zone.portals[0];
	// The single true tick (what the edge queue emits) — transfer to Town.
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);
	expect(zoneOf(w, 7)).toBe('town-01');
	const arrived = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	// Every subsequent tick reports interact=false (the edge was consumed) — no bounce,
	// even though the arrival overlaps the return Portal.
	for (let i = 0; i < 3; i++)
		w = stepServerWorld(w, [holdAt(7, arrived?.avatar.x ?? 0, false)], 16);
	expect(zoneOf(w, 7)).toBe('town-01');
});

test('a session receives snapshots for only its current Zone', () => {
	let w = addSession(makeWorld(), 7, 'neo'); // mover
	w = addSession(w, 8, 'trinity'); // stays in the Field
	const fieldPortal = zoneOrThrow(w, 'field-01').zone.portals[0];
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true), holdAt(8, 60)], 16);

	const moverView = worldSnapshotFor(w, 7);
	expect(moverView.zoneId).toBe('town-01');
	expect(moverView.avatars.some((a) => a.sessionId === 7)).toBe(true);

	const stayerView = worldSnapshotFor(w, 8);
	expect(stayerView.zoneId).toBe('field-01');
	// the stayer no longer sees the session that left for Town
	expect(stayerView.avatars.some((a) => a.sessionId === 7)).toBe(false);
});

test('progress and inventory survive a Portal transfer', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const before = zoneOrThrow(w, 'field-01').avatars[0];
	before.progress = { level: 5, xp: 40, gold: 99 };
	before.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'epic', affixes: [] },
	];
	const fieldPortal = zoneOrThrow(w, 'field-01').zone.portals[0];
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.progress).toEqual({ level: 5, xp: 40, gold: 99 });
	expect(moved?.inventory.length).toBe(1);
});

test('a forgiving death respawns the Avatar in Town with full HP and no loss', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const av = zoneOrThrow(w, 'field-01').avatars[0];
	av.avatar.hp = 1;
	av.progress = { level: 4, xp: 20, gold: 50 };
	av.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	// Stand just inside a ground-level Field chaser's melee reach so it commits a
	// telegraphed swing whose active strike finishes the 1-HP Avatar (contact damage
	// is gone — ADR 0017 §9). Drive a few ticks for the wind-up→active to land.
	const m = zoneOrThrow(w, 'field-01').zone.monsters.find((mm) => mm.y === y);
	if (!m) throw new Error('expected a ground-level Monster in field-01');
	for (let i = 0; i < 20 && zoneOf(w, 7) !== 'town-01'; i++)
		w = stepServerWorld(w, [holdAt(7, m.x + 3)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(
		zoneOrThrow(w, 'field-01').avatars.some((a) => a.sessionId === 7),
	).toBe(false);
	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.hp).toBe(moved?.avatar.maxHp); // full HP
	expect(moved?.avatar.x).toBe(TOWN_SPAWN.x);
	expect(moved?.progress).toEqual({ level: 4, xp: 20, gold: 50 }); // no XP/Gold loss
	expect(moved?.inventory.length).toBe(1); // no Item loss
});

test('stepServerWorld is deterministic for an identical world + intents', () => {
	const run = () => {
		const w = addSession(makeWorld(), 7, 'neo');
		const portal = zoneOrThrow(w, 'field-01').zone.portals[0];
		return stepServerWorld(w, [holdAt(7, portal.x, true)], 16);
	};
	const a = run();
	const b = run();
	expect(zoneOf(b, 7)).toBe(zoneOf(a, 7));
	const am = zoneStateOf(a, 7)?.avatars.find((x) => x.sessionId === 7);
	const bm = zoneStateOf(b, 7)?.avatars.find((x) => x.sessionId === 7);
	expect(bm?.avatar.x).toBe(am?.avatar.x);
	expect(bm?.avatar.y).toBe(am?.avatar.y);
});

test('removeSession drops a disconnected session from its Zone and the map', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = removeSession(w, 7);
	expect(zoneOf(w, 7)).toBeUndefined();
	expect(zoneOrThrow(w, 'field-01').avatars.length).toBe(0);
	expect(removeSession(w, 99)).toBe(w); // unknown session is a no-op
});

// --- Funnel: one shared instance per Zone, no Channels (ADR 0024, #234) -------

test('every entrant to a Zone joins its single shared instance — no channel split', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');
	w = addSession(w, 3, 'c');

	// All three co-locate in the one shared field-01 — never scattered.
	expect(zoneOf(w, 1)).toBe('field-01');
	expect(zoneOf(w, 2)).toBe('field-01');
	expect(zoneOf(w, 3)).toBe('field-01');

	// One shared ZoneState per NON-Dungeon Zone; the instanced Dungeon (#240) has no
	// shared instance, so it is absent from `zones`. The Field holds everyone.
	expect(Object.keys(w.zones).sort()).toEqual(
		loadZones()
			.filter((z) => z.type !== 'dungeon')
			.map((z) => z.id)
			.sort(),
	);
	expect(zoneOrThrow(w, 'field-01').avatars.length).toBe(3);
});

test('two sessions in the same Zone always see each other (funnelled presence)', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');

	const view1 = worldSnapshotFor(w, 1);
	expect(view1.zoneId).toBe('field-01');
	expect(view1.avatars.map((a) => a.sessionId).sort()).toEqual([1, 2]);

	const view2 = worldSnapshotFor(w, 2);
	expect(view2.zoneId).toBe('field-01');
	expect(view2.avatars.map((a) => a.sessionId).sort()).toEqual([1, 2]);
});

test('a cross-Zone relocation lands both sessions in the destination shared instance', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');

	// Both stand on the (static) Field->Town portal and enter together.
	const portalX = zoneOrThrow(w, 'field-01').zone.portals[0].x;
	w = stepServerWorld(
		w,
		[holdAt(1, portalX, true), holdAt(2, portalX, true)],
		16,
	);

	expect(zoneOf(w, 1)).toBe('town-01');
	expect(zoneOf(w, 2)).toBe('town-01');
	// They co-locate in the one shared Town — no parallel instances.
	expect(
		zoneOrThrow(w, 'town-01')
			.avatars.map((a) => a.sessionId)
			.sort(),
	).toEqual([1, 2]);
});

test('sessionsInZone returns every session sharing a Zone, including itself', () => {
	let w = addSession(makeWorld(), 1, 'a');
	w = addSession(w, 2, 'b'); // same shared Zone
	expect(sessionsInZone(w, 1).sort()).toEqual([1, 2]);
	expect(sessionsInZone(w, 2).sort()).toEqual([1, 2]);
});

test('sessionsInZone excludes a session that has left for another Zone', () => {
	let w = addSession(makeWorld(), 1, 'a'); // both start in field-01
	w = addSession(w, 2, 'b');
	const portal = zoneOrThrow(w, 'field-01').zone.portals[0];
	// Session 1 walks the portal to Town; session 2 stays in the Field.
	w = stepServerWorld(w, [holdAt(1, portal.x, true), holdAt(2, 60)], 16);
	expect(zoneOf(w, 1)).toBe('town-01');
	expect(sessionsInZone(w, 1)).toEqual([1]); // alone in Town
	expect(sessionsInZone(w, 2)).toEqual([2]); // alone in the Field
});

test('sessionsInZone is empty for an unknown / unplaced session', () => {
	const w = addSession(makeWorld(), 1, 'a');
	expect(sessionsInZone(w, 99)).toEqual([]);
});

test('sessionByHandle finds an online session across Zones, case-insensitively', () => {
	let w = addSession(makeWorld(), 1, 'Neo'); // field-01
	w = addSession(w, 2, 'Trinity');
	const portal = zoneOrThrow(w, 'field-01').zone.portals[0];
	// Move Trinity to Town so the two sit in different Zones.
	w = stepServerWorld(w, [holdAt(2, portal.x, true), holdAt(1, 60)], 16);
	expect(zoneOf(w, 1)).toBe('field-01');
	expect(zoneOf(w, 2)).toBe('town-01');
	// Whisper is world-wide: a handle resolves regardless of Zone, ignoring case.
	expect(sessionByHandle(w, 'neo')).toBe(1);
	expect(sessionByHandle(w, 'TRINITY')).toBe(2);
});

test('sessionByHandle returns undefined for a handle that is not online', () => {
	const w = addSession(makeWorld(), 1, 'neo');
	expect(sessionByHandle(w, 'ghost')).toBeUndefined();
});

test('sessionByHandle resolves a duplicated handle to the lowest sessionId (unambiguous)', () => {
	let w = addSession(makeWorld(), 5, 'neo');
	w = addSession(w, 3, 'NEO'); // same handle, different case
	expect(sessionByHandle(w, 'neo')).toBe(3);
});

test('handleOf returns a placed session handle, undefined otherwise', () => {
	const w = addSession(makeWorld(), 7, 'Neo');
	expect(handleOf(w, 7)).toBe('Neo');
	expect(handleOf(w, 99)).toBeUndefined();
});

// --- Dungeon: private, instanced entry from Town (#240) -----------------------

// A Town-start world: sessions spawn in the hub, from where they portal into the
// instanced Dungeon.
function townWorld(): ServerWorld {
	return createServerWorld({
		zones: loadZones(),
		start: 'town-01',
		town: 'town-01',
	});
}

// The x of the Town → Dungeon Portal (glyph S) an Avatar stands on to enter.
function dungeonEntryX(w: ServerWorld): number {
	const p = w.templates['town-01'].portals.find(
		(pp) => pp.target === 'dungeon-01',
	);
	if (!p) throw new Error('town-01 must portal to dungeon-01');
	return p.x;
}

// The x of the Dungeon → Town return Portal an Avatar stands on to leave.
function dungeonExitX(w: ServerWorld): number {
	const p = w.templates['dungeon-01'].portals.find(
		(pp) => pp.target === 'town-01',
	);
	if (!p) throw new Error('dungeon-01 must portal back to town-01');
	return p.x;
}

// Walk one session from Town onto the Dungeon Portal and enter — one step relocates it
// into a private instance.
function enterDungeon(w: ServerWorld, sessionId: number): ServerWorld {
	return stepServerWorld(w, [holdAt(sessionId, dungeonEntryX(w), true)], 16);
}

test('the authored Dungeon exists, is instanced, and has no shared instance', () => {
	const w = townWorld();
	const dungeon = w.templates['dungeon-01'];
	expect(dungeon?.type).toBe('dungeon');
	expect(dungeon.spawns.length).toBeGreaterThan(0); // a reliable XP/loot faucet
	// Fixed difficulty, repeatable: no shared ZoneState is ever created for it.
	expect(zoneInstance(w, 'dungeon-01')).toBeUndefined();
	expect(w.zones['dungeon-01']).toBeUndefined();
	// It is reachable from the hub (entered from Town) and round-trips back.
	expect(dungeon.portals.some((p) => p.target === 'town-01')).toBe(true);
});

test('entering the Dungeon from Town spins up a private instance (create on entry)', () => {
	let w = addSession(townWorld(), 1, 'neo');
	expect(Object.keys(w.instances).length).toBe(0);

	w = enterDungeon(w, 1);

	expect(zoneOf(w, 1)).toBe('dungeon-01');
	expect(Object.keys(w.instances).length).toBe(1);
	expect(w.instanceOf[1]).toBeDefined();
	// The Avatar is inside its instance, and the instance streams as its Zone.
	const zs = zoneStateOf(w, 1);
	expect(zs?.zone.id).toBe('dungeon-01');
	expect(zs?.avatars.some((a) => a.sessionId === 1)).toBe(true);
	expect(worldSnapshotFor(w, 1).zoneId).toBe('dungeon-01');
});

test('leaving the Dungeon tears the instance down (teardown on exit)', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = enterDungeon(w, 1);
	expect(Object.keys(w.instances).length).toBe(1);

	// Stand on the Dungeon's return Portal and step back out to Town.
	w = stepServerWorld(w, [holdAt(1, dungeonExitX(w), true)], 16);

	expect(zoneOf(w, 1)).toBe('town-01');
	expect(w.instanceOf[1]).toBeUndefined();
	expect(Object.keys(w.instances).length).toBe(0); // torn down — nobody left inside
});

test('a forgiving death in the Dungeon exits to Town and tears the instance down', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = enterDungeon(w, 1);
	const key = w.instanceOf[1];
	// Drive the Avatar's HP to 0 inside the instance; the next tick is a forgiving death.
	w.instances[key] = {
		...w.instances[key],
		avatars: w.instances[key].avatars.map((a) => ({
			...a,
			avatar: { ...a.avatar, hp: 0 },
		})),
	};
	w = stepServerWorld(w, [holdAt(1, 10)], 16);

	expect(zoneOf(w, 1)).toBe('town-01');
	expect(w.instanceOf[1]).toBeUndefined();
	expect(Object.keys(w.instances).length).toBe(0);
});

test('strangers never share a Dungeon instance — each gets its own private run', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = addSession(w, 2, 'trinity'); // unrelated session, same hub, no party
	// Both step onto the Dungeon Portal together.
	const x = dungeonEntryX(w);
	w = stepServerWorld(w, [holdAt(1, x, true), holdAt(2, x, true)], 16);

	expect(zoneOf(w, 1)).toBe('dungeon-01');
	expect(zoneOf(w, 2)).toBe('dungeon-01');
	// Two separate instances — different keys, one Avatar each.
	expect(Object.keys(w.instances).length).toBe(2);
	expect(w.instanceOf[1]).not.toBe(w.instanceOf[2]);
	expect(w.instances[w.instanceOf[1]].avatars.length).toBe(1);
	expect(w.instances[w.instanceOf[2]].avatars.length).toBe(1);
	// They neither share a simulation nor see each other.
	expect(sessionsInZone(w, 1)).toEqual([1]);
	expect(sessionsInZone(w, 2)).toEqual([2]);
	expect(worldSnapshotFor(w, 1).avatars.some((a) => a.sessionId === 2)).toBe(
		false,
	);
});

test('a friend (party) co-locates in one shared Dungeon instance', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = addSession(w, 2, 'trinity');
	w = joinParty(w, 2, 1); // trinity runs with neo
	const x = dungeonEntryX(w);
	w = stepServerWorld(w, [holdAt(1, x, true), holdAt(2, x, true)], 16);

	// One instance, both inside it.
	expect(Object.keys(w.instances).length).toBe(1);
	expect(w.instanceOf[1]).toBe(w.instanceOf[2]);
	expect(w.instances[w.instanceOf[1]].avatars.length).toBe(2);
	// They share the simulation and see each other.
	expect(sessionsInZone(w, 1).sort()).toEqual([1, 2]);
	expect(
		worldSnapshotFor(w, 1)
			.avatars.map((a) => a.sessionId)
			.sort(),
	).toEqual([1, 2]);
});

test('the last party-mate leaving tears the shared instance down; the first does not', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = addSession(w, 2, 'trinity');
	w = joinParty(w, 2, 1);
	const x = dungeonEntryX(w);
	w = stepServerWorld(w, [holdAt(1, x, true), holdAt(2, x, true)], 16);
	const key = w.instanceOf[1];

	// Session 1 leaves; the instance stays up for session 2.
	w = stepServerWorld(w, [holdAt(1, dungeonExitX(w), true), holdAt(2, 20)], 16);
	expect(zoneOf(w, 1)).toBe('town-01');
	expect(zoneOf(w, 2)).toBe('dungeon-01');
	expect(w.instances[key]?.avatars.length).toBe(1);

	// Session 2 leaves too; now the run is empty and torn down.
	w = stepServerWorld(w, [holdAt(2, dungeonExitX(w), true)], 16);
	expect(zoneOf(w, 2)).toBe('town-01');
	expect(Object.keys(w.instances).length).toBe(0);
});

test('disconnecting inside a Dungeon tears down a solo instance', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = enterDungeon(w, 1);
	expect(Object.keys(w.instances).length).toBe(1);
	w = removeSession(w, 1);
	expect(zoneOf(w, 1)).toBeUndefined();
	expect(w.instanceOf[1]).toBeUndefined();
	expect(Object.keys(w.instances).length).toBe(0);
});

test('a re-entered Dungeon is a fresh instance (repeatable faucet)', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = enterDungeon(w, 1);
	const first = w.instanceOf[1];
	w = stepServerWorld(w, [holdAt(1, dungeonExitX(w), true)], 16); // back to Town
	expect(Object.keys(w.instances).length).toBe(0);
	w = enterDungeon(w, 1); // run it again
	expect(zoneOf(w, 1)).toBe('dungeon-01');
	expect(Object.keys(w.instances).length).toBe(1);
	// Same solo key (keyed by owner), but a freshly-created ZoneState (tick reset).
	expect(w.instanceOf[1]).toBe(first);
	expect(w.instances[w.instanceOf[1]].tick).toBe(0);
});

// --- Server-authoritative sell (#267, ADR 0025) ----------------------------

const sellable = (over: Partial<Item> = {}): Item => ({
	id: 1,
	base: 'Rusty Sword',
	slot: 'weapon',
	rarity: 'rare',
	affixes: [{ stat: 'str', value: 3 }],
	...over,
});

// Place session 1 in Town with a seeded inventory, then report it standing at `x` — the
// Merchant's column by default, so it passes the proximity gate (positions are client-
// trusted, ADR 0001). Returns the world and the Town's Merchant NPC.
function sellWorld(
	inventory: Item[],
	gold: number,
	standAtMerchant = true,
): { w: ServerWorld; merchant: Npc } {
	let w = townWorld();
	w = addSession(
		w,
		1,
		'neo',
		undefined,
		undefined,
		restoredFromSave({
			...emptySave('neo', 'town-01'),
			inventory,
			progress: { level: 2, xp: 0, gold },
		}),
	);
	const merchant = zoneOrThrow(w, 'town-01').zone.npcs?.find(
		(n) => n.kind === 'vendor',
	);
	if (!merchant) throw new Error('town-01 must have a Merchant');
	// Report the Avatar either on the Merchant or far away (x 0), trusted verbatim.
	const x = standAtMerchant ? merchant.x : 0;
	w = stepServerWorld(
		w,
		[
			{
				sessionId: 1,
				x,
				y: merchant.y,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				attack: false,
			},
		],
		16,
	);
	return { w, merchant };
}

function avatarOf(w: ServerWorld, sessionId: number) {
	return zoneStateOf(w, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
}

test('atMerchant is true standing on the Town Merchant, false when away', () => {
	expect(atMerchant(sellWorld([sellable()], 0).w, 1)).toBe(true);
	expect(atMerchant(sellWorld([sellable()], 0, false).w, 1)).toBe(false);
});

test('applySell removes the Item and credits its re-derived sale value to Gold', () => {
	const item = sellable({ id: 7 });
	const { w } = sellWorld(
		[item, sellable({ id: 8, base: 'Copper Ring' })],
		100,
	);
	const res = applySell(w, 1, 7);
	expect(res.sold).toBe(true);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([8]); // id 7 gone
	expect(sa?.progress.gold).toBe(100 + saleValue(item)); // price is server-derived
	expect(sa?.log.at(-1)).toContain('Sold'); // a sell log line is appended
});

test('selling an unowned id is a no-op — Gold and inventory unchanged', () => {
	const { w } = sellWorld([sellable({ id: 7 })], 100);
	const res = applySell(w, 1, 999); // 999 not held
	expect(res.sold).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([7]);
	expect(sa?.progress.gold).toBe(100);
});

test('selling the same id twice: the second sell is a no-op (no double credit)', () => {
	const item = sellable({ id: 7 });
	const first = applySell(sellWorld([item], 0).w, 1, 7);
	expect(first.sold).toBe(true);
	const gold = avatarOf(first.world, 1)?.progress.gold;
	const second = applySell(first.world, 1, 7); // already gone
	expect(second.sold).toBe(false);
	expect(avatarOf(second.world, 1)?.progress.gold).toBe(gold);
});

test('a sell away from any Merchant is refused — never trust the client', () => {
	const { w } = sellWorld([sellable({ id: 7 })], 100, false); // standing at x 0
	const res = applySell(w, 1, 7);
	expect(res.sold).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([7]); // Item kept
	expect(sa?.progress.gold).toBe(100);
});

test('applySell for an unplaced session is a no-op', () => {
	const res = applySell(townWorld(), 999, 1);
	expect(res.sold).toBe(false);
});

// --- Server-authoritative buy (#273, ADR 0025) -----------------------------

test('applyBuy deducts the re-derived price, appends the good, and logs it', () => {
	const good = STARTER_GOODS[0]; // Rusty Sword, price 15
	const { w } = sellWorld([], 100);
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(true);
	const sa = avatarOf(res.world, 1);
	expect(sa?.progress.gold).toBe(100 - good.price); // price is server-derived
	const added = sa?.inventory.at(-1);
	expect(added?.base).toBe(good.base);
	expect(added?.slot).toBe(good.slot);
	expect(added?.rarity).toBe('common');
	expect(added?.affixes).toEqual([]);
	expect(sa?.log.at(-1)).toContain('Bought'); // a buy log line is appended
});

test('two buys mint distinct Item ids (nextId advances)', () => {
	const { w } = sellWorld([], 100);
	const first = applyBuy(w, 1, 0);
	const second = applyBuy(first.world, 1, 0);
	expect(second.bought).toBe(true);
	const ids = avatarOf(second.world, 1)?.inventory.map((i) => i.id) ?? [];
	expect(new Set(ids).size).toBe(ids.length); // all unique
	expect(ids.length).toBe(2);
});

test('buying when unaffordable is a no-op — Gold and inventory unchanged', () => {
	const good = STARTER_GOODS[0];
	const { w } = sellWorld([], good.price - 1); // one Gold short
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.progress.gold).toBe(good.price - 1);
	expect(sa?.inventory).toEqual([]);
});

test('buying an out-of-range catalog index is refused', () => {
	const { w } = sellWorld([], 1000);
	expect(applyBuy(w, 1, STARTER_GOODS.length).bought).toBe(false);
	expect(applyBuy(w, 1, -1).bought).toBe(false);
	expect(avatarOf(applyBuy(w, 1, 99).world, 1)?.progress.gold).toBe(1000);
});

test('a buy away from any Merchant is refused — never trust the client', () => {
	const { w } = sellWorld([], 1000, false); // standing at x 0
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory).toEqual([]);
	expect(sa?.progress.gold).toBe(1000);
});

test('applyBuy for an unplaced session is a no-op', () => {
	expect(applyBuy(townWorld(), 999, 0).bought).toBe(false);
});

test('round-trip buy then sell is always a net Gold loss', () => {
	for (let i = 0; i < STARTER_GOODS.length; i++) {
		const { w } = sellWorld([], 100);
		const boughtRes = applyBuy(w, 1, i);
		expect(boughtRes.bought).toBe(true);
		const minted = avatarOf(boughtRes.world, 1)?.inventory.at(-1);
		if (!minted) throw new Error('bought Item missing');
		const soldRes = applySell(boughtRes.world, 1, minted.id);
		expect(soldRes.sold).toBe(true);
		expect(avatarOf(soldRes.world, 1)?.progress.gold).toBeLessThan(100);
	}
});
