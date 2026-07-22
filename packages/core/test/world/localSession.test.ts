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
	zoneOf,
} from '../../src/world';

const IDLE: Input = { moveX: 0, jump: false, attack: false };
const INTERACT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	interact: true,
};
const AUTHORED_ZONES = loadZones();

function authoredZone(type: 'field' | 'town' | 'dungeon') {
	const found = AUTHORED_ZONES.find((candidate) => candidate.type === type);
	if (!found) throw new Error(`authored set has no ${type} Zone`);
	return found;
}

const FIELD_ID = authoredZone('field').id;
const TOWN_ID = authoredZone('town').id;

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
	const lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
	expect(zone(lw).zone.id).toBe(TOWN_ID);
	expect(zone(lw).zone.type).toBe('town');
	expect(me(lw).avatar.type).toBe('player');
	expect(zone(lw).tick).toBe(0);
});

test('every authored Zone boots and ticks on the local World runtime', () => {
	for (const z of AUTHORED_ZONES) {
		let lw = createLocalWorld(AUTHORED_ZONES, z.id);
		expect(zone(lw).zone.id).toBe(z.id);
		for (let i = 0; i < 5; i++) lw = stepLocalWorld(lw, IDLE, 16);
		expect(zone(lw).tick).toBe(5);
		expect(me(lw).avatar.type).toBe('player');
	}
});

test('createLocalWorld falls back to the first Zone for an unknown start id', () => {
	const lw = createLocalWorld(AUTHORED_ZONES, 'no-such-zone');
	expect(zone(lw).zone.id).toBe(AUTHORED_ZONES[0].id);
});

test('a step ticks the world; walking right moves the Avatar right', () => {
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
	const x0 = me(lw).avatar.x;
	for (let i = 0; i < 10; i++)
		lw = stepLocalWorld(lw, { moveX: 1, jump: false, attack: false }, 16);
	expect(zone(lw).tick).toBe(10);
	expect(me(lw).avatar.x).toBeGreaterThan(x0);
});

test('no transition without the interact intent, even while on a Portal', () => {
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
	me(lw).avatar.x = zone(lw).zone.portals[0].x;
	lw = stepLocalWorld(lw, IDLE, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe(TOWN_ID);
});

test('no transition when the Avatar is not overlapping a Portal', () => {
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
	const portal = zone(lw).zone.portals[0];
	me(lw).avatar.x = portal.x + portal.w + 20;
	lw = stepLocalWorld(lw, INTERACT, 16);
	expect(zoneOf(lw.world, lw.sessionId)).toBe(TOWN_ID);
});

test('the Town stays Monster-free and combat-free across many ticks', () => {
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
	const startHp = me(lw).avatar.hp;
	for (let i = 0; i < 300; i++) {
		lw = stepLocalWorld(lw, { moveX: 0, jump: false, attack: i % 2 === 0 }, 16);
		expect(zone(lw).zone.monsters.length).toBe(0);
		expect(zone(lw).zone.projectiles.length).toBe(0);
	}
	expect(me(lw).avatar.hp).toBe(startHp);
});

test('a Dodge hops in the held direction via the client-side impulse gate', () => {
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
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
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
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
	let lw = createLocalWorld(AUTHORED_ZONES, TOWN_ID);
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
		let lw = createLocalWorld(AUTHORED_ZONES, FIELD_ID);
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
