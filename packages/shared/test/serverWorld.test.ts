import { expect, test } from 'bun:test';
import type { AvatarIntent, ServerWorld } from '../src';
import {
	addSession,
	BOX,
	createServerWorld,
	GROUND_TOP,
	handleOf,
	loadZones,
	removeSession,
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

	// Exactly one ZoneState per authored Zone; the Field holds everyone.
	expect(Object.keys(w.zones).sort()).toEqual(
		loadZones()
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
