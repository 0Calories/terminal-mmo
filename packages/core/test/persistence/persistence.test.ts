import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import { DEFAULT_WEAPON } from '../../src/combat';
import { DEFAULT_COSMETICS, type Item } from '../../src/entities';
import {
	emptySave,
	migrateSaveCosmetics,
	type PlayerSave,
	registryFromSaves,
	restoredFromSave,
	saveFromAvatar,
} from '../../src/persistence';
import { addSession, createServerWorld, zoneStateOf } from '../../src/world';

function freshAvatar() {
	const w = addSession(
		createServerWorld({
			zones: loadZones(),
			start: 'town-01',
			town: 'town-01',
		}),
		1,
		'Cypher',
	);
	const sa = zoneStateOf(w, 1)?.avatars.find((a) => a.sessionId === 1);
	if (!sa) throw new Error('no avatar');
	return sa;
}

test('emptySave is a level-1 blank slate returning to the given Town', () => {
	const s = emptySave('Neo', 'town-01');
	expect(s).toEqual({
		handle: 'Neo',
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		equippedWeapon: DEFAULT_WEAPON,
		cosmetics: DEFAULT_COSMETICS,
		lastTown: 'town-01',
		bossDefeated: false,
	});
});

test('a fresh Avatar seeds lastTown to its spawn Town, not the flush fallback', () => {
	const save = saveFromAvatar(freshAvatar(), 'some-other-town');
	expect(save.lastTown).toBe('town-01');
	expect(save.bossDefeated).toBe(false);
	expect(save.equippedWeapon).toBe(DEFAULT_WEAPON);
});

test('restoredFromSave clamps out-of-range cosmetics at the trust boundary', () => {
	const save: PlayerSave = {
		...emptySave('Neo', 'town-01'),
		cosmetics: {
			hue: 999,
			hat: -1 as unknown as string,
			nameplate: 4.5,
			form: 'buddy',
		},
	};
	const restored = restoredFromSave(save);
	expect(restored.cosmetics).toEqual(DEFAULT_COSMETICS);
});

test('migrateSaveCosmetics maps a legacy numeric hat index through LEGACY_HAT_IDS', () => {
	const base = { hue: 0, nameplate: 0, form: 'buddy' };
	expect(migrateSaveCosmetics({ ...base, hat: 1 })).toEqual({
		...base,
		hat: 'cap',
	});
	expect(migrateSaveCosmetics({ ...base, hat: 5 })).toEqual({
		...base,
		hat: 'party-hat',
	});
	expect(migrateSaveCosmetics({ ...base, hat: 0 })).toEqual({
		...base,
		hat: '',
	});
});

test('migrateSaveCosmetics maps an out-of-range legacy hat index to the empty (no-hat) id', () => {
	const base = { hue: 0, nameplate: 0, form: 'buddy' };
	expect(migrateSaveCosmetics({ ...base, hat: 250 })).toEqual({
		...base,
		hat: '',
	});
	expect(migrateSaveCosmetics({ ...base, hat: -1 })).toEqual({
		...base,
		hat: '',
	});
});

test('migrateSaveCosmetics maps a legacy numeric form index through LEGACY_FORM_IDS', () => {
	const base = { hue: 0, hat: '', nameplate: 0 };

	expect(migrateSaveCosmetics({ ...base, form: 0 })).toEqual({
		...base,
		form: 'buddy',
	});
});

test('migrateSaveCosmetics maps an out-of-range legacy form index to the default Form', () => {
	const base = { hue: 0, hat: '', nameplate: 0 };
	expect(migrateSaveCosmetics({ ...base, form: 250 })).toEqual({
		...base,
		form: 'buddy',
	});
	expect(migrateSaveCosmetics({ ...base, form: -1 })).toEqual({
		...base,
		form: 'buddy',
	});
});

test('migrateSaveCosmetics is a no-op for an already-migrated string hat + form', () => {
	const c = { hue: 0, hat: 'cap', nameplate: 0, form: 'buddy' };
	expect(migrateSaveCosmetics(c)).toEqual(c);
});

test('restoredFromSave migrates a numeric-hat + numeric-form Save written before ADR 0031', () => {
	const save = {
		...emptySave('Neo', 'town-01'),
		cosmetics: { hue: 2, hat: 3, nameplate: 1, form: 0 },
	} as unknown as PlayerSave;
	const restored = restoredFromSave(save);
	expect(restored.cosmetics).toEqual({
		hue: 2,
		hat: 'wizard',
		nameplate: 1,
		form: 'buddy',
	});
});

test('a restored inventory keeps saved Items and mints fresh ids past the highest', () => {
	const items: Item[] = [
		{ id: 4, base: 'Iron Sword', slot: 'weapon', rarity: 'rare', affixes: [] },
		{ id: 9, base: 'Oak Shield', slot: 'armor', rarity: 'common', affixes: [] },
	];
	const save: PlayerSave = { ...emptySave('Neo', 'town-01'), inventory: items };
	const w = addSession(
		createServerWorld({
			zones: loadZones(),
			start: 'town-01',
			town: 'town-01',
		}),
		1,
		'Neo',
		undefined,
		undefined,
		restoredFromSave(save),
	);
	const sa = zoneStateOf(w, 1)?.avatars.find((a) => a.sessionId === 1);
	expect(sa?.inventory).toEqual(items);
	expect(sa?.nextId).toBe(10);
});

test('registryFromSaves is case-insensitive on the reverse Handle index', () => {
	const reg = registryFromSaves([
		['key-a', { ...emptySave('NeoOne', 'town-01') }],
	]);
	expect(reg.handleByKey['key-a']).toBe('NeoOne');
	expect(reg.keyByHandle.neoone).toBe('key-a');
});
