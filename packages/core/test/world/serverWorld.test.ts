import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import { DEFAULT_WEAPON } from '../../src/combat';
import type { Cosmetics } from '../../src/entities';
import { BOX, DEFAULT_COSMETICS } from '../../src/entities';
import type { ServerWorld } from '../../src/world';
import {
	addSession,
	createServerWorld,
	handleOf,
	joinParty,
	removeSession,
	sessionByHandle,
	sessionsInZone,
	spawnNewAvatar,
	stepServerWorld,
	worldSnapshotFor,
	zoneInstance,
	zoneOf,
	zoneStateOf,
} from '../../src/world';
import type { AvatarIntent } from '../../src/zones';
import { GROUND_TOP } from '../../src/zones';

const y = GROUND_TOP - BOX.h;
const AUTHORED_ZONES = loadZones();

function authoredZone(type: 'field' | 'town' | 'dungeon') {
	const found = AUTHORED_ZONES.find((candidate) => candidate.type === type);
	if (!found) throw new Error(`authored set has no ${type} Zone`);
	return found;
}

const FIELD_ID = authoredZone('field').id;
const TOWN_ID = authoredZone('town').id;
const DUNGEON_ID = authoredZone('dungeon').id;

function zoneOrThrow(w: ServerWorld, zone: string) {
	const zs = zoneInstance(w, zone);
	if (!zs) throw new Error(`expected a shared instance of ${zone}`);
	return zs;
}

function makeWorld(): ServerWorld {
	return createServerWorld({
		zones: AUTHORED_ZONES,
		start: FIELD_ID,
		town: TOWN_ID,
	});
}

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

function portalX(w: ServerWorld, from: string, to: string): number {
	const portal = zoneOrThrow(w, from).zone.portals.find(
		(candidate) => candidate.target === to,
	);
	if (!portal) throw new Error(`${from} must portal to ${to}`);
	return portal.x;
}

test('addSession places a new session in the start Zone with its handle', () => {
	const w = addSession(makeWorld(), 7, 'neo');
	expect(zoneOf(w, 7)).toBe(FIELD_ID);
	const here = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(here?.handle).toBe('neo');
	expect(zoneOrThrow(w, TOWN_ID).avatars.length).toBe(0);
});

test('stepServerWorld advances every Zone each tick', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = stepServerWorld(w, [holdAt(7, 20)], 16);
	expect(zoneOrThrow(w, FIELD_ID).tick).toBe(1);
	expect(zoneOrThrow(w, TOWN_ID).tick).toBe(1);
});

test('a session receives snapshots for only its current Zone', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = addSession(w, 8, 'trinity');
	const exitX = portalX(w, FIELD_ID, TOWN_ID);
	w = stepServerWorld(w, [holdAt(7, exitX, true), holdAt(8, 60)], 16);

	const moverView = worldSnapshotFor(w, 7);
	expect(moverView.zoneId).toBe(TOWN_ID);
	expect(moverView.avatars.some((a) => a.sessionId === 7)).toBe(true);

	const stayerView = worldSnapshotFor(w, 8);
	expect(stayerView.zoneId).toBe(FIELD_ID);
	expect(stayerView.avatars.some((a) => a.sessionId === 7)).toBe(false);
});

test('progress and inventory survive a Portal transfer', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const before = zoneOrThrow(w, FIELD_ID).avatars[0];
	before.progress = { level: 5, xp: 40, gold: 99 };
	before.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'epic', affixes: [] },
	];
	w = stepServerWorld(w, [holdAt(7, portalX(w, FIELD_ID, TOWN_ID), true)], 16);

	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.progress).toEqual({ level: 5, xp: 40, gold: 99 });
	expect(moved?.inventory.length).toBe(1);
});

test('death preserves progress and inventory', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const av = zoneOrThrow(w, FIELD_ID).avatars[0];
	av.avatar.hp = 0;
	av.progress = { level: 4, xp: 20, gold: 50 };
	av.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	w = stepServerWorld(w, [holdAt(7, av.avatar.x)], 16);
	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.progress).toEqual({ level: 4, xp: 20, gold: 50 });
	expect(moved?.inventory.length).toBe(1);
});

test('stepServerWorld is deterministic for an identical world + intents', () => {
	const run = () => {
		const w = addSession(makeWorld(), 7, 'neo');
		return stepServerWorld(
			w,
			[holdAt(7, portalX(w, FIELD_ID, TOWN_ID), true)],
			16,
		);
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
	expect(zoneOrThrow(w, FIELD_ID).avatars.length).toBe(0);
	expect(removeSession(w, 99)).toBe(w);
});

test('spawnNewAvatar spawns into the starting Town with the chosen look, and mints a matching Save', () => {
	const chosen: Cosmetics = { ...DEFAULT_COSMETICS, hue: 5 };
	const before = townWorld();
	expect(zoneOf(before, 7)).toBeUndefined();

	const { world, save } = spawnNewAvatar(
		before,
		7,
		'neo',
		chosen,
		DEFAULT_WEAPON,
		TOWN_ID,
	);

	expect(zoneOf(world, 7)).toBe(TOWN_ID);
	const sa = avatarOf(world, 7);
	expect(sa?.handle).toBe('neo');
	expect(sa?.cosmetics).toEqual(chosen);
	expect(sa?.avatar.weapon).toBe(DEFAULT_WEAPON);
	expect(save.handle).toBe('neo');
	expect(save.cosmetics).toEqual(chosen);
	expect(save.equippedWeapon).toBe(DEFAULT_WEAPON);
	expect(save.lastTown).toBe(TOWN_ID);
	expect(save.progress).toEqual({ level: 1, xp: 0, gold: 0 });
	expect(save.inventory).toEqual([]);
});

test('spawnNewAvatar is pure — it never mutates the world passed in', () => {
	const before = townWorld();
	spawnNewAvatar(before, 7, 'neo', DEFAULT_COSMETICS, DEFAULT_WEAPON, TOWN_ID);
	expect(zoneOf(before, 7)).toBeUndefined();
});

test('every entrant to a Zone joins its single shared instance — no channel split', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');
	w = addSession(w, 3, 'c');

	expect(zoneOf(w, 1)).toBe(FIELD_ID);
	expect(zoneOf(w, 2)).toBe(FIELD_ID);
	expect(zoneOf(w, 3)).toBe(FIELD_ID);

	expect(Object.keys(w.zones).sort()).toEqual(
		AUTHORED_ZONES.filter((z) => z.type !== 'dungeon')
			.map((z) => z.id)
			.sort(),
	);
	expect(zoneOrThrow(w, FIELD_ID).avatars.length).toBe(3);
});

test('two sessions in the same Zone always see each other (funnelled presence)', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');

	const view1 = worldSnapshotFor(w, 1);
	expect(view1.zoneId).toBe(FIELD_ID);
	expect(view1.avatars.map((a) => a.sessionId).sort()).toEqual([1, 2]);

	const view2 = worldSnapshotFor(w, 2);
	expect(view2.zoneId).toBe(FIELD_ID);
	expect(view2.avatars.map((a) => a.sessionId).sort()).toEqual([1, 2]);
});

test('a cross-Zone relocation lands both sessions in the destination shared instance', () => {
	let w = makeWorld();
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');

	const exitX = portalX(w, FIELD_ID, TOWN_ID);
	w = stepServerWorld(w, [holdAt(1, exitX, true), holdAt(2, exitX, true)], 16);

	expect(zoneOf(w, 1)).toBe(TOWN_ID);
	expect(zoneOf(w, 2)).toBe(TOWN_ID);
	expect(
		zoneOrThrow(w, TOWN_ID)
			.avatars.map((a) => a.sessionId)
			.sort(),
	).toEqual([1, 2]);
});

test('sessionsInZone returns every session sharing a Zone, including itself', () => {
	let w = addSession(makeWorld(), 1, 'a');
	w = addSession(w, 2, 'b');
	expect(sessionsInZone(w, 1).sort()).toEqual([1, 2]);
	expect(sessionsInZone(w, 2).sort()).toEqual([1, 2]);
});

test('sessionsInZone excludes a session that has left for another Zone', () => {
	let w = addSession(makeWorld(), 1, 'a');
	w = addSession(w, 2, 'b');
	const exitX = portalX(w, FIELD_ID, TOWN_ID);
	w = stepServerWorld(w, [holdAt(1, exitX, true), holdAt(2, 60)], 16);
	expect(zoneOf(w, 1)).toBe(TOWN_ID);
	expect(sessionsInZone(w, 1)).toEqual([1]);
	expect(sessionsInZone(w, 2)).toEqual([2]);
});

test('sessionsInZone is empty for an unknown / unplaced session', () => {
	const w = addSession(makeWorld(), 1, 'a');
	expect(sessionsInZone(w, 99)).toEqual([]);
});

test('sessionByHandle finds an online session across Zones, case-insensitively', () => {
	let w = addSession(makeWorld(), 1, 'Neo');
	w = addSession(w, 2, 'Trinity');
	const exitX = portalX(w, FIELD_ID, TOWN_ID);
	w = stepServerWorld(w, [holdAt(2, exitX, true), holdAt(1, 60)], 16);
	expect(zoneOf(w, 1)).toBe(FIELD_ID);
	expect(zoneOf(w, 2)).toBe(TOWN_ID);
	expect(sessionByHandle(w, 'neo')).toBe(1);
	expect(sessionByHandle(w, 'TRINITY')).toBe(2);
});

test('sessionByHandle returns undefined for a handle that is not online', () => {
	const w = addSession(makeWorld(), 1, 'neo');
	expect(sessionByHandle(w, 'ghost')).toBeUndefined();
});

test('sessionByHandle resolves a duplicated handle to the lowest sessionId (unambiguous)', () => {
	let w = addSession(makeWorld(), 5, 'neo');
	w = addSession(w, 3, 'NEO');
	expect(sessionByHandle(w, 'neo')).toBe(3);
});

test('handleOf returns a placed session handle, undefined otherwise', () => {
	const w = addSession(makeWorld(), 7, 'Neo');
	expect(handleOf(w, 7)).toBe('Neo');
	expect(handleOf(w, 99)).toBeUndefined();
});

function townWorld(): ServerWorld {
	return createServerWorld({
		zones: AUTHORED_ZONES,
		start: TOWN_ID,
		town: TOWN_ID,
	});
}

function dungeonEntryX(w: ServerWorld): number {
	const p = w.templates[TOWN_ID].portals.find(
		(candidate) => candidate.target === DUNGEON_ID,
	);
	if (!p) throw new Error(`${TOWN_ID} must portal to ${DUNGEON_ID}`);
	return p.x;
}

function dungeonExitX(w: ServerWorld): number {
	const p = w.templates[DUNGEON_ID].portals.find(
		(candidate) => candidate.target === TOWN_ID,
	);
	if (!p) throw new Error(`${DUNGEON_ID} must portal back to ${TOWN_ID}`);
	return p.x;
}

function enterDungeon(w: ServerWorld, sessionId: number): ServerWorld {
	return stepServerWorld(w, [holdAt(sessionId, dungeonEntryX(w), true)], 16);
}

test('the authored Dungeon exists, is instanced, and has no shared instance', () => {
	const w = townWorld();
	const dungeon = w.templates[DUNGEON_ID];
	expect(dungeon?.type).toBe('dungeon');
	expect(dungeon.spawns.length).toBeGreaterThan(0);
	expect(zoneInstance(w, DUNGEON_ID)).toBeUndefined();
	expect(w.zones[DUNGEON_ID]).toBeUndefined();
	expect(dungeon.portals.some((p) => p.target === TOWN_ID)).toBe(true);
});

test('strangers never share a Dungeon instance — each gets its own private run', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = addSession(w, 2, 'trinity');
	const x = dungeonEntryX(w);
	w = stepServerWorld(w, [holdAt(1, x, true), holdAt(2, x, true)], 16);

	expect(zoneOf(w, 1)).toBe(DUNGEON_ID);
	expect(zoneOf(w, 2)).toBe(DUNGEON_ID);
	expect(Object.keys(w.instances).length).toBe(2);
	expect(w.instanceOf[1]).not.toBe(w.instanceOf[2]);
	expect(w.instances[w.instanceOf[1]].avatars.length).toBe(1);
	expect(w.instances[w.instanceOf[2]].avatars.length).toBe(1);
	expect(sessionsInZone(w, 1)).toEqual([1]);
	expect(sessionsInZone(w, 2)).toEqual([2]);
	expect(worldSnapshotFor(w, 1).avatars.some((a) => a.sessionId === 2)).toBe(
		false,
	);
});

test('a friend (party) co-locates in one shared Dungeon instance', () => {
	let w = addSession(townWorld(), 1, 'neo');
	w = addSession(w, 2, 'trinity');
	w = joinParty(w, 2, 1);
	const x = dungeonEntryX(w);
	w = stepServerWorld(w, [holdAt(1, x, true), holdAt(2, x, true)], 16);

	expect(Object.keys(w.instances).length).toBe(1);
	expect(w.instanceOf[1]).toBe(w.instanceOf[2]);
	expect(w.instances[w.instanceOf[1]].avatars.length).toBe(2);
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

	w = stepServerWorld(w, [holdAt(1, dungeonExitX(w), true), holdAt(2, 20)], 16);
	expect(zoneOf(w, 1)).toBe(TOWN_ID);
	expect(zoneOf(w, 2)).toBe(DUNGEON_ID);
	expect(w.instances[key]?.avatars.length).toBe(1);

	w = stepServerWorld(w, [holdAt(2, dungeonExitX(w), true)], 16);
	expect(zoneOf(w, 2)).toBe(TOWN_ID);
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

function avatarOf(w: ServerWorld, sessionId: number) {
	return zoneStateOf(w, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
}
