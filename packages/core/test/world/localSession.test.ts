// The synthetic local session: the old single-player runtime's coverage,
// re-expressed against the ONE world runtime. Every portal, death, and
// dungeon assertion here runs the same stepServerWorld the live server ticks.
import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import type { Input } from '../../src/entities';
import { CAPABILITY_UNLOCK } from '../../src/progression';
import {
	createLocalWorld,
	type LocalWorld,
	localAvatar,
	localZoneState,
	stepLocalWorld,
	TOWN_SPAWN,
	zoneOf,
} from '../../src/world';

const IDLE: Input = { moveX: 0, jump: false, attack: false };
const INTERACT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	interact: true,
};

function me(lw: LocalWorld) {
	const sa = localAvatar(lw);
	if (!sa) throw new Error('local session has no Avatar');
	return sa;
}

function zone(lw: LocalWorld) {
	const zs = localZoneState(lw);
	if (!zs) throw new Error('local session is not placed in any Zone');
	return zs;
}

test('createLocalWorld boots the authored set with one placed session', () => {
	const zones = loadZones();
	const lw = createLocalWorld(zones, zones[0].id);
	expect(zone(lw).zone.id).toBe(zones[0].id);
	expect(zone(lw).zone.type).toBe('town');
	expect(me(lw).avatar.type).toBe('player');
	expect(zone(lw).tick).toBe(0);
});

test('createLocalWorld falls back to the first Zone for an unknown start id', () => {
	const lw = createLocalWorld(loadZones(), 'no-such-zone');
	expect(zone(lw).zone.id).toBe(loadZones()[0].id);
});

test('a step ticks the world; walking right moves the Avatar right', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	const x0 = me(lw).avatar.x;
	for (let i = 0; i < 10; i++)
		lw = stepLocalWorld(lw, { moveX: 1, jump: false, attack: false }, 16);
	expect(zone(lw).tick).toBe(10);
	expect(me(lw).avatar.x).toBeGreaterThan(x0);
});

test('entering a Portal switches the Zone and repositions at the arrival point', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	const portal = zone(lw).zone.portals.find((p) => p.target === 'field-01');
	if (!portal) throw new Error('town-01 must portal to field-01');
	me(lw).avatar.x = portal.x;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('field-01');
	expect(me(lw).avatar.x).toBe(portal.arrival.x);
	expect(me(lw).avatar.y).toBe(portal.arrival.y);
});

test('persistent state (progress + inventory) survives a Portal transition', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	me(lw).progress = { level: 3, xp: 17, gold: 42 };
	me(lw).inventory = [
		{ id: 7, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	const portal = zone(lw).zone.portals.find((p) => p.target === 'field-01');
	if (!portal) throw new Error('town-01 must portal to field-01');
	me(lw).avatar.x = portal.x;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(me(lw).progress).toEqual({ level: 3, xp: 17, gold: 42 });
	expect(me(lw).inventory.map((i) => i.id)).toEqual([7]);
});

test('no transition without the interact intent, even while on a Portal', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	me(lw).avatar.x = zone(lw).zone.portals[0].x;
	lw = stepLocalWorld(lw, IDLE, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
});

test('no transition when the Avatar is not overlapping a Portal', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	const portal = zone(lw).zone.portals[0];
	me(lw).avatar.x = portal.x + portal.w + 20;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
});

test('the authored set wires a round-trip Portal pair: Town → Field → Town', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	const townPortal = zone(lw).zone.portals.find((p) => p.target === 'field-01');
	if (!townPortal) throw new Error('town-01 must portal to field-01');
	me(lw).avatar.x = townPortal.x;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('field-01');

	const fieldPortal = zone(lw).zone.portals.find((p) => p.target === 'town-01');
	if (!fieldPortal) throw new Error('field-01 must portal back to town-01');
	me(lw).avatar.x = fieldPortal.x;
	me(lw).avatar.y = fieldPortal.y;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
	expect(me(lw).avatar.x).toBe(fieldPortal.arrival.x);
});

test('a forgiving death relocates to Town at full HP — exactly as on the live server', () => {
	let lw = createLocalWorld(loadZones(), 'field-01');
	me(lw).progress = { level: 2, xp: 5, gold: 9 };
	me(lw).avatar.hp = 0;
	lw = stepLocalWorld(lw, IDLE, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
	expect(me(lw).avatar.hp).toBe(me(lw).avatar.maxHp);
	expect(me(lw).avatar.x).toBe(TOWN_SPAWN.x);
	expect(me(lw).progress).toEqual({ level: 2, xp: 5, gold: 9 });
});

test('playing a Dungeon directly seeds a private instance (create on entry)', () => {
	const lw = createLocalWorld(loadZones(), 'dungeon-01');
	expect(zoneOf(lw.world, lw.sessionId)).toBe('dungeon-01');
	expect(Object.keys(lw.world.instances).length).toBe(1);
	expect(lw.world.zones['dungeon-01']).toBeUndefined();
	expect(zone(lw).zone.type).toBe('dungeon');
	expect(me(lw).sessionId).toBe(lw.sessionId);
});

test('leaving the played Dungeon through its Portal tears the instance down', () => {
	let lw = createLocalWorld(loadZones(), 'dungeon-01');
	const exit = zone(lw).zone.portals.find((p) => p.target === 'town-01');
	if (!exit) throw new Error('dungeon-01 must portal back to town-01');
	me(lw).avatar.x = exit.x;
	me(lw).avatar.y = exit.y;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
	expect(Object.keys(lw.world.instances).length).toBe(0);
});

test('a dungeon death exits to Town and tears the private instance down', () => {
	let lw = createLocalWorld(loadZones(), 'dungeon-01');
	me(lw).avatar.hp = 0;
	lw = stepLocalWorld(lw, IDLE, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe('town-01');
	expect(Object.keys(lw.world.instances).length).toBe(0);
});

test('the Town stays Monster-free and combat-free across many ticks', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	const startHp = me(lw).avatar.hp;
	for (let i = 0; i < 300; i++) {
		lw = stepLocalWorld(lw, { moveX: 0, jump: false, attack: i % 2 === 0 }, 16);
		expect(zone(lw).zone.monsters.length).toBe(0);
		expect(zone(lw).zone.projectiles.length).toBe(0);
	}
	expect(me(lw).avatar.hp).toBe(startHp);
});

test('a Dodge hops in the held direction via the client-side impulse gate', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	me(lw).avatar.onGround = true;
	me(lw).progress.level = CAPABILITY_UNLOCK.dodge;
	const x0 = me(lw).avatar.x;
	lw = stepLocalWorld(
		lw,
		{ moveX: 1, jump: false, attack: false, dodge: true },
		16,
	);
	expect(me(lw).avatar.dodgeT ?? 0).toBeGreaterThan(0);
	expect(me(lw).avatar.ivx ?? 0).toBeGreaterThan(0);
	expect(me(lw).avatar.x).toBeGreaterThan(x0);
});

test('a Dodge below the unlock level is refused — no hop, no i-frames', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	me(lw).avatar.onGround = true;
	me(lw).progress.level = CAPABILITY_UNLOCK.dodge - 1;
	lw = stepLocalWorld(
		lw,
		{ moveX: 1, jump: false, attack: false, dodge: true },
		16,
	);
	expect(me(lw).avatar.dodgeT ?? 0).toBe(0);
});

test('a standstill dodge does nothing — a direction must be held', () => {
	let lw = createLocalWorld(loadZones(), 'town-01');
	me(lw).avatar.onGround = true;
	me(lw).progress.level = CAPABILITY_UNLOCK.dodge;
	lw = stepLocalWorld(
		lw,
		{ moveX: 0, jump: false, attack: false, dodge: true },
		16,
	);
	expect(me(lw).avatar.dodgeT ?? 0).toBe(0);
	expect(me(lw).avatar.ivx ?? 0).toBe(0);
});

test('stepLocalWorld is deterministic for identical inputs', () => {
	const run = () => {
		let lw = createLocalWorld(loadZones(), 'field-01');
		const seq: Input = { moveX: 1, jump: false, attack: true };
		for (let i = 0; i < 40; i++) lw = stepLocalWorld(lw, seq, 16);
		return lw;
	};
	const a = run();
	const b = run();
	expect(me(b).avatar.x).toBe(me(a).avatar.x);
	expect(me(b).avatar.hp).toBe(me(a).avatar.hp);
	expect(me(b).progress.xp).toBe(me(a).progress.xp);
	expect(zone(b).zone.monsters.length).toBe(zone(a).zone.monsters.length);
});
