import { expect, test } from 'bun:test';
import type {
	AvatarIntent,
	Entity,
	ServerAvatar,
	Zone,
	ZoneState,
} from '../src';
import {
	addAvatar,
	BOX,
	clientStepAvatar,
	createZoneState,
	GROUND_TOP,
	MONSTER,
	removeAvatar,
	SPAWN,
	snapshotFor,
	spawnAvatar,
	spawnMonster,
	stepZone,
	XP_PER_KILL,
} from '../src';
import { flatTerrain } from './helpers';

const y = GROUND_TOP - BOX.h;

function serverAvatar(
	sessionId: number,
	x: number,
	handle = 'hero',
): ServerAvatar {
	return {
		sessionId,
		handle,
		avatar: { ...spawnAvatar(x, y), id: sessionId },
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
	};
}

function zoneWith(monsters: Entity[]): Zone {
	return {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters,
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 100,
	};
}

// hold position, no attack, reporting the avatar's current spot back to the server
function holdAt(sessionId: number, e: Entity): AvatarIntent {
	return {
		sessionId,
		x: e.x,
		y: e.y,
		vx: 0,
		vy: 0,
		facing: e.facing,
		onGround: e.onGround,
		attack: false,
	};
}

test('an Avatar attack intent damages an adjacent Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters[0].hp).toBe(MONSTER.chaserHp - 8);
	expect(next.tick).toBe(1);
});

test('the Avatar landing the killing blow earns the XP and the loot roll', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // one swing kills
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters.length).toBe(0);
	const me = next.avatars[0];
	expect(me.progress.xp).toBe(XP_PER_KILL);
	expect(me.inventory.length).toBe(1);
	expect(me.inventory[0].id).toBe(1); // from the killer's own nextId
});

test('a living Monster touching an Avatar deals server-owned contact damage', () => {
	const m = spawnMonster('chaser', 2, 20, y); // stacked on the avatar
	m.onGround = true;
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(before - MONSTER.contactDamage);
	expect(next.avatars[0].avatar.hurtT).toBeGreaterThan(0);
});

test('a Monster targets and chases the nearest Avatar', () => {
	const m = spawnMonster('chaser', 2, 50, y);
	m.onGround = true;
	const near = serverAvatar(7, 45); // 5 away
	const far = serverAvatar(8, 10); // 40 away
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [far, near],
		tick: 0,
	};
	const next = stepZone(
		state,
		[holdAt(8, far.avatar), holdAt(7, near.avatar)],
		16,
	);
	expect(next.zone.monsters[0].x).toBeLessThan(50); // moved toward x=45, not x=10
});

test('only the Avatar landing the kill is credited when two are present', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4;
	const attacker = serverAvatar(7, 20); // adjacent, swings
	const bystander = serverAvatar(8, 200); // far away, idle
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [attacker, bystander],
		tick: 0,
	};
	const next = stepZone(
		state,
		[
			{ ...holdAt(7, attacker.avatar), attack: true },
			holdAt(8, bystander.avatar),
		],
		16,
	);
	expect(next.avatars[0].progress.xp).toBe(XP_PER_KILL);
	expect(next.avatars[0].inventory.length).toBe(1);
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
});

test('an Avatar reduced to 0 HP respawns at the safe point at full HP', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = spawnMonster('chaser', 2, 20, y); // contact will finish it
	m.onGround = true;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	const a = next.avatars[0].avatar;
	expect(a.hp).toBe(a.maxHp);
	expect(a.x).toBe(SPAWN.x);
	expect(a.y).toBe(SPAWN.y);
});

test('stepZone reports the sessions that died this tick in deaths', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = spawnMonster('chaser', 2, 20, y); // contact finishes the Avatar
	m.onGround = true;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.deaths).toEqual([7]);
});

test('stepZone reports no deaths when every Avatar survives the tick', () => {
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.deaths).toEqual([]);
});

test('stepZone is deterministic for identical state + intents', () => {
	const mk = () => {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.hp = 4;
		const av = serverAvatar(7, 20);
		return { zone: zoneWith([m]), avatars: [av], tick: 0 } as ZoneState;
	};
	const intent: AvatarIntent = {
		...holdAt(7, serverAvatar(7, 20).avatar),
		attack: true,
	};
	const a = stepZone(mk(), [intent], 16);
	const b = stepZone(mk(), [intent], 16);
	expect(b.avatars[0].inventory[0]).toEqual(a.avatars[0].inventory[0]);
	expect(b.avatars[0].progress.xp).toBe(a.avatars[0].progress.xp);
});

test('removeAvatar drops a disconnected session from the Zone', () => {
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	expect(removeAvatar(state, 7).avatars.length).toBe(0);
	expect(removeAvatar(state, 99).avatars.length).toBe(1); // unknown id is a no-op
});

test('addAvatar spawns a Warrior at the safe point with its handle', () => {
	const spawned = addAvatar(createZoneState(zoneWith([])), 7, 'neo');
	expect(spawned.avatars.length).toBe(1);
	expect(spawned.avatars[0].sessionId).toBe(7);
	expect(spawned.avatars[0].handle).toBe('neo');
	expect(spawned.avatars[0].avatar.x).toBe(SPAWN.x);
});

test('clientStepAvatar predicts platformer movement and decays the swing timer', () => {
	const a = { ...spawnAvatar(20, y), attackT: 0.3 };
	const predicted = clientStepAvatar(
		flatTerrain(),
		a,
		{ moveX: 1, jump: false },
		16,
	);
	expect(predicted.x).toBeGreaterThan(20); // ran right
	expect(predicted.attackT).toBeLessThan(0.3); // cooldown ticked down locally
});

test('snapshotFor carries the zone state + the recipient private fields', () => {
	const m = spawnMonster('shooter', 2, 50, y);
	const a = serverAvatar(7, 20, 'morpheus');
	a.progress = { level: 2, xp: 5, gold: 9 };
	const b = serverAvatar(8, 60, 'trinity');
	const state: ZoneState = { zone: zoneWith([m]), avatars: [a, b], tick: 3 };
	const snap = snapshotFor(state, 7);
	expect(snap.t).toBe('snapshot');
	expect(snap.tick).toBe(3);
	expect(snap.avatars.length).toBe(2); // sees both Avatars
	expect(snap.avatars.find((s) => s.sessionId === 8)?.handle).toBe('trinity');
	expect(snap.monsters.length).toBe(1);
	expect(snap.progress).toEqual({ level: 2, xp: 5, gold: 9 }); // recipient's own
	expect(snap.zoneId).toBe('field-01'); // the zone the recipient is currently in
});
