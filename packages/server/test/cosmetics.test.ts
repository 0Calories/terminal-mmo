// Cosmetics request handling at its own home (ADR 0032): these tests moved
// from the core world module when applyCosmetics was evicted to the server.
import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets/meta';
import { type Cosmetics, DEFAULT_COSMETICS } from '@mmo/core/entities';
import {
	addSession,
	createServerWorld,
	type ServerWorld,
	spawnNewAvatar,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/core/world';
import { applyCosmetics } from '../src/cosmetics';

function makeWorld(): ServerWorld {
	return createServerWorld({
		zones: loadZones(),
		start: 'field-01',
		town: 'town-01',
	});
}

function avatarOf(w: ServerWorld, sessionId: number) {
	return zoneStateOf(w, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
}

test('applyCosmetics in a Town stamps the new look on the live Avatar (rebroadcast + persist path) (#305)', () => {
	const { world } = spawnNewAvatar(
		makeWorld(),
		7,
		'neo',
		DEFAULT_COSMETICS,
		0,
		'town-01',
	);
	expect(zoneOf(world, 7)).toBe('town-01');
	const next: Cosmetics = { hue: 3, hat: 'cap', nameplate: 2, form: 'buddy' };
	const res = applyCosmetics(world, 7, next);
	expect(res.changed).toBe(true);
	const seen = worldSnapshotFor(res.world, 7).avatars.find(
		(a) => a.sessionId === 7,
	);
	expect(seen?.cosmetics).toEqual(next);
});

test('applyCosmetics clamps an out-of-range index at the apply boundary (#305)', () => {
	const { world } = spawnNewAvatar(
		makeWorld(),
		7,
		'neo',
		DEFAULT_COSMETICS,
		0,
		'town-01',
	);
	const res = applyCosmetics(world, 7, {
		hue: 2,
		hat: 250 as unknown as string,
		nameplate: 1,
		form: 250 as unknown as string,
	});
	expect(res.changed).toBe(true);
	expect(avatarOf(res.world, 7)?.cosmetics).toEqual({
		hue: 2,
		hat: '',
		nameplate: 1,
		form: 'buddy',
	});
});

test('applyCosmetics outside a Town is a silent no-op (Town-only re-customize) (#305)', () => {
	const world = addSession(makeWorld(), 7, 'neo');
	expect(zoneOf(world, 7)).toBe('field-01');
	const res = applyCosmetics(world, 7, {
		hue: 3,
		hat: 'cap',
		nameplate: 2,
		form: 'buddy',
	});
	expect(res.changed).toBe(false);
	expect(res.world).toBe(world);
	expect(avatarOf(world, 7)?.cosmetics).toEqual(DEFAULT_COSMETICS);
});

test('applyCosmetics for an unplaced session is a silent no-op (#305)', () => {
	const world = makeWorld();
	const res = applyCosmetics(world, 999, {
		hue: 1,
		hat: 'cap',
		nameplate: 1,
		form: 'buddy',
	});
	expect(res.changed).toBe(false);
	expect(res.world).toBe(world);
});
