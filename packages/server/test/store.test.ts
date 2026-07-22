import { expect, test } from 'bun:test';
import type { Item } from '@mmo/core/entities';
import { type PlayerSave, registryFromSaves } from '@mmo/core/persistence';
import { openPlayerStore } from '../src/store';

const KEY = 'ssh-ed25519 AAAAtestkeyblob';

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
