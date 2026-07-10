import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets/meta';
import {
	addSession,
	createServerWorld,
	type Item,
	type PlayerSave,
	registryFromSaves,
	restoredFromSave,
	type ServerWorld,
	saveFromAvatar,
	stepServerWorld,
	zoneOf,
	zoneStateOf,
} from '@mmo/core';
import { openPlayerStore } from '../src/store';

const KEY = 'ssh-ed25519 AAAAtestkeyblob';

function avatarOf(w: ServerWorld, sessionId: number) {
	const sa = zoneStateOf(w, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
	if (!sa) throw new Error(`no avatar for session ${sessionId}`);
	return sa;
}

const gear: Item = {
	id: 3,
	base: 'Iron Sword',
	slot: 'weapon',
	rarity: 'rare',
	affixes: [{ stat: 'atk', value: 5 }],
};

function richSave(): PlayerSave {
	return {
		handle: 'Trinity',
		progress: { level: 7, xp: 420, gold: 999 },
		inventory: [gear],
		equippedWeapon: 2,
		cosmetics: { hue: 1, hat: 'crown', nameplate: 1, form: 'buddy' },
		lastTown: 'town-01',
		bossDefeated: true,
	};
}

test('save then load round-trips every persisted field, incl the boss-defeated flag', () => {
	const store = openPlayerStore(':memory:');
	const save = richSave();
	store.save(KEY, save);
	expect(store.load(KEY)).toEqual(save);
	expect(store.load(KEY)?.bossDefeated).toBe(true);
	store.close();
});

test('an unseen key loads undefined; a re-save upserts in place', () => {
	const store = openPlayerStore(':memory:');
	expect(store.load(KEY)).toBeUndefined();
	store.save(KEY, richSave());
	store.save(KEY, { ...richSave(), progress: { level: 7, xp: 420, gold: 5 } });
	expect(store.load(KEY)?.progress.gold).toBe(5);
	expect(store.all().length).toBe(1);
	store.close();
});

test('registryFromSaves rebuilds the account registry from persisted rows', () => {
	const store = openPlayerStore(':memory:');
	store.save('key-a', { ...richSave(), handle: 'Neo' });
	store.save('key-b', { ...richSave(), handle: 'Morpheus' });
	const reg = registryFromSaves(store.all());
	expect(reg.handleByKey['key-a']).toBe('Neo');
	expect(reg.keyByHandle.morpheus).toBe('key-b');
	store.close();
});

test('a live Avatar round-trips durable state but not transient position/HP', () => {
	const store = openPlayerStore(':memory:');
	const world = createServerWorld({
		zones: loadZones(),
		start: 'town-01',
		town: 'town-01',
	});

	let w = addSession(world, 1, 'Trinity');
	const sa = avatarOf(w, 1);
	const progressed = {
		...sa,
		progress: { level: 7, xp: 420, gold: 999 },
		inventory: [gear],
		cosmetics: { hue: 1, hat: 'cap', nameplate: 1, form: 'buddy' },
		bossDefeated: true,
		avatar: { ...sa.avatar, weapon: 2, x: 123, y: 45, hp: 3, vx: 9 },
	};

	const save = saveFromAvatar(progressed, 'town-01');
	store.save(KEY, save);
	const reloaded = store.load(KEY);
	if (!reloaded) throw new Error('save missing');

	w = addSession(
		world,
		2,
		'Trinity',
		undefined,
		undefined,
		restoredFromSave(reloaded),
	);
	const back = avatarOf(w, 2);

	expect(back.progress).toEqual({ level: 7, xp: 420, gold: 999 });
	expect(back.inventory).toEqual([gear]);
	expect(back.avatar.weapon).toBe(2);
	expect(back.cosmetics).toEqual({
		hue: 1,
		hat: 'cap',
		nameplate: 1,
		form: 'buddy',
	});
	expect(back.bossDefeated).toBe(true);
	expect(back.avatar.x).not.toBe(123);
	expect(back.avatar.hp).toBe(back.avatar.maxHp);
	expect(back.avatar.hp).toBeGreaterThan(3);
	store.close();
});

test('the save carries no Monster or transient Zone state', () => {
	const store = openPlayerStore(':memory:');
	const world = createServerWorld({
		zones: loadZones(),
		start: 'town-01',
		town: 'town-01',
	});
	const w = addSession(world, 1, 'Trinity');
	const save = saveFromAvatar(avatarOf(w, 1), 'town-01');
	const keys = Object.keys(save).sort();
	expect(keys).toEqual(
		[
			'bossDefeated',
			'cosmetics',
			'equippedWeapon',
			'handle',
			'inventory',
			'lastTown',
			'progress',
		].sort(),
	);
	store.close();
});

test('login returns the Avatar to its last safe Town', () => {
	const store = openPlayerStore(':memory:');
	const world = createServerWorld({
		zones: loadZones(),
		start: 'field-01',
		town: 'town-01',
	});
	let w = addSession(world, 1, 'Trinity');
	expect(zoneOf(w, 1)).toBe('field-01');

	const portal = w.zones['field-01'].zone.portals.find(
		(p) => p.target === 'town-01',
	);
	if (!portal) throw new Error('expected a town portal in field-01');
	const intent = {
		sessionId: 1,
		x: portal.x,
		y: portal.y,
		vx: 0,
		vy: 0,
		facing: 1 as const,
		onGround: true,
		attack: false,
		interact: true,
	};
	w = stepServerWorld(w, [intent], 50);
	expect(zoneOf(w, 1)).toBe('town-01');

	const save = saveFromAvatar(avatarOf(w, 1), 'town-01');
	expect(save.lastTown).toBe('town-01');
	store.save(KEY, save);
	const w2 = addSession(
		world,
		2,
		'Trinity',
		undefined,
		undefined,
		restoredFromSave(save),
	);
	expect(zoneOf(w2, 2)).toBe('town-01');
	store.close();
});
