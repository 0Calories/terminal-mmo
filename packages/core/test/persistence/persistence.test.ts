import { describe, expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import { DEFAULT_WEAPON } from '../../src/combat';
import {
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	type Item,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
} from '../../src/entities';
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
	const zones = loadZones();
	const town = zones.find((zone) => zone.type === 'town')?.id;
	if (!town) throw new Error('authored assets need a Town fixture');
	const world = addSession(
		createServerWorld({ zones, start: town, town }),
		1,
		'Cypher',
	);
	const avatar = zoneStateOf(world, 1)?.avatars.find((a) => a.sessionId === 1);
	if (!avatar) throw new Error('no avatar');
	return avatar;
}

describe('Save schema', () => {
	test('a new Save uses configured defaults and the supplied durable identity', () => {
		expect(emptySave('Neo', 'safe-town')).toEqual({
			handle: 'Neo',
			progress: { level: 1, xp: 0, gold: 0 },
			inventory: [],
			equippedWeapon: DEFAULT_WEAPON,
			cosmetics: DEFAULT_COSMETICS,
			lastTown: 'safe-town',
			bossDefeated: false,
		});
	});

	test('Avatar → Save → restored Avatar round-trips every durable field', () => {
		const avatar = freshAvatar();
		avatar.progress = { level: 3, xp: 4, gold: 5 };
		avatar.inventory = [
			{
				id: 7,
				base: 'Test Blade',
				slot: 'weapon',
				rarity: 'rare',
				affixes: [],
			},
		];
		avatar.avatar.weapon = 9;
		avatar.cosmetics = {
			hue: 1,
			hat: 'test-hat',
			nameplate: 2,
			form: 'test-form',
		};
		avatar.lastTown = 'durable-town';
		avatar.bossDefeated = true;
		avatar.log = ['transient'];
		avatar.rngState = 987;
		avatar.skillCooldowns = { skill: 2 };

		const save = saveFromAvatar(avatar, 'fallback-town');
		expect(save).toEqual({
			handle: avatar.handle,
			progress: avatar.progress,
			inventory: avatar.inventory,
			equippedWeapon: avatar.avatar.weapon,
			cosmetics: avatar.cosmetics,
			lastTown: avatar.lastTown,
			bossDefeated: avatar.bossDefeated,
		});
		expect(restoredFromSave(save)).toEqual({
			progress: save.progress,
			inventory: save.inventory,
			equippedWeapon: save.equippedWeapon,
			cosmetics: save.cosmetics,
			lastTown: save.lastTown,
			bossDefeated: save.bossDefeated,
		});
	});

	test('the spawn Town wins over the flush fallback', () => {
		const avatar = freshAvatar();
		avatar.lastTown = 'spawn-town';
		expect(saveFromAvatar(avatar, 'fallback-town').lastTown).toBe('spawn-town');
	});

	test('restoration clamps untrusted cosmetics', () => {
		const save: PlayerSave = {
			...emptySave('Neo', 'town'),
			cosmetics: {
				hue: 999,
				hat: -1 as unknown as string,
				nameplate: 4.5,
				form: 7 as unknown as string,
			},
		};
		expect(restoredFromSave(save).cosmetics).toEqual(DEFAULT_COSMETICS);
	});
});

describe('legacy cosmetic migration', () => {
	for (const [kind, ids, fallback] of [
		['hat', LEGACY_HAT_IDS, ''],
		['form', LEGACY_FORM_IDS, DEFAULT_FORM_ID],
	] as const) {
		test(`numeric ${kind} indexes map through the frozen compatibility table`, () => {
			for (const [index, id] of ids.entries()) {
				const cosmetics = migrateSaveCosmetics({
					hue: 0,
					hat: kind === 'hat' ? index : '',
					nameplate: 0,
					form: kind === 'form' ? index : DEFAULT_FORM_ID,
				});
				expect(cosmetics[kind]).toBe(id);
			}
		});

		test(`out-of-range numeric ${kind} indexes use the compatibility fallback`, () => {
			for (const index of [-1, ids.length, 250]) {
				const cosmetics = migrateSaveCosmetics({
					hue: 0,
					hat: kind === 'hat' ? index : '',
					nameplate: 0,
					form: kind === 'form' ? index : DEFAULT_FORM_ID,
				});
				expect(cosmetics[kind]).toBe(fallback);
			}
		});
	}

	test('already-migrated string ids pass through unchanged', () => {
		const cosmetics = {
			hue: 0,
			hat: 'custom-hat',
			nameplate: 0,
			form: 'custom-form',
		};
		expect(migrateSaveCosmetics(cosmetics)).toEqual(cosmetics);
	});
});

test('restored inventories retain Items and mint ids beyond the durable maximum', () => {
	const items: Item[] = [
		{ id: 4, base: 'Test Sword', slot: 'weapon', rarity: 'rare', affixes: [] },
		{
			id: 9,
			base: 'Test Shield',
			slot: 'armor',
			rarity: 'common',
			affixes: [],
		},
	];
	const zones = loadZones();
	const town = zones.find((zone) => zone.type === 'town')?.id;
	if (!town) throw new Error('authored assets need a Town fixture');
	const restored = restoredFromSave({
		...emptySave('Neo', town),
		inventory: items,
	});
	const world = addSession(
		createServerWorld({ zones, start: town, town }),
		1,
		'Neo',
		undefined,
		undefined,
		restored,
	);
	const avatar = zoneStateOf(world, 1)?.avatars.find((a) => a.sessionId === 1);
	expect(avatar?.inventory).toEqual(items);
	expect(avatar?.nextId).toBe(Math.max(...items.map((item) => item.id)) + 1);
});

test('registry restoration indexes Handles case-insensitively', () => {
	const registry = registryFromSaves([
		['key-a', emptySave('MixedCase', 'town')],
	]);
	expect(registry.handleByKey['key-a']).toBe('MixedCase');
	expect(registry.keyByHandle.mixedcase).toBe('key-a');
});
