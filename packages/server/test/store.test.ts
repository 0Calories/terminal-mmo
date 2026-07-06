// Persistence seam tests (#236) against an in-memory bun:sqlite — the same store the
// server runs, opened at ':memory:'. Asserts the full durable round-trip through the
// sqlite backing + the pure @mmo/shared transforms: every persisted field survives a
// save→load (including the boss-defeated flag), excluded transient state is not
// persisted, and a returning login is placed back in its last safe Town.

import { expect, test } from 'bun:test';
import {
	addSession,
	createServerWorld,
	type Item,
	loadZones,
	type PlayerSave,
	registryFromSaves,
	restoredFromSave,
	type ServerWorld,
	saveFromAvatar,
	stepServerWorld,
	zoneOf,
	zoneStateOf,
} from '@mmo/shared';
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

// A well-progressed save with every persisted field set to a non-default value.
function richSave(): PlayerSave {
	return {
		handle: 'Trinity',
		progress: { level: 7, xp: 420, gold: 999 },
		inventory: [gear],
		equippedWeapon: 2,
		cosmetics: { hue: 1, hat: 1, nameplate: 1, form: 0 },
		lastTown: 'town-01',
		bossDefeated: true,
	};
}

test('save then load round-trips every persisted field, incl the boss-defeated flag', () => {
	const store = openPlayerStore(':memory:');
	const save = richSave();
	store.save(KEY, save);
	expect(store.load(KEY)).toEqual(save);
	// Explicit: the boss-defeated flag field exists and survives the round-trip.
	expect(store.load(KEY)?.bossDefeated).toBe(true);
	store.close();
});

test('an unseen key loads undefined; a re-save upserts in place', () => {
	const store = openPlayerStore(':memory:');
	expect(store.load(KEY)).toBeUndefined();
	store.save(KEY, richSave());
	store.save(KEY, { ...richSave(), progress: { level: 7, xp: 420, gold: 5 } });
	expect(store.load(KEY)?.progress.gold).toBe(5);
	expect(store.all().length).toBe(1); // upsert, not a second row
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

// The seam's whole point: a live Avatar's durable state survives a save→load→restore and
// comes back identical, while its transient position/HP/timers do NOT.
test('a live Avatar round-trips durable state but not transient position/HP', () => {
	const store = openPlayerStore(':memory:');
	const world = createServerWorld({
		zones: loadZones(),
		start: 'town-01',
		town: 'town-01',
	});

	// Place a fresh session, then simulate progression by editing its ServerAvatar.
	let w = addSession(world, 1, 'Trinity');
	const sa = avatarOf(w, 1);
	const progressed = {
		...sa,
		progress: { level: 7, xp: 420, gold: 999 },
		inventory: [gear],
		cosmetics: { hue: 1, hat: 1, nameplate: 1, form: 0 },
		bossDefeated: true,
		avatar: { ...sa.avatar, weapon: 2, x: 123, y: 45, hp: 3, vx: 9 },
	};

	// Flush → persist → reload → restore into a brand-new login.
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

	// Durable state restored...
	expect(back.progress).toEqual({ level: 7, xp: 420, gold: 999 });
	expect(back.inventory).toEqual([gear]);
	expect(back.avatar.weapon).toBe(2);
	expect(back.cosmetics).toEqual({ hue: 1, hat: 1, nameplate: 1, form: 0 });
	expect(back.bossDefeated).toBe(true);
	// ...transient state is NOT: position resets to the safe spawn, HP is full for level.
	expect(back.avatar.x).not.toBe(123);
	expect(back.avatar.hp).toBe(back.avatar.maxHp);
	expect(back.avatar.hp).toBeGreaterThan(3);
	store.close();
});

// Monsters and transient Zone state never reach the save — it carries only account fields.
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

// Login returns the Avatar to the last safe Town it stood in — not its logged-off Zone.
test('login returns the Avatar to its last safe Town', () => {
	const store = openPlayerStore(':memory:');
	const world = createServerWorld({
		zones: loadZones(),
		start: 'field-01', // spawn out in the Field
		town: 'town-01',
	});
	let w = addSession(world, 1, 'Trinity');
	expect(zoneOf(w, 1)).toBe('field-01');

	// Walk onto the Field's Town portal and interact — relocating into town-01.
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

	// Flush, disconnect, and log back in — restored into town-01, not field-01.
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
