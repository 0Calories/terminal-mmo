import { expect, test } from 'bun:test';
import { CATALOGS, loadZones, validateZoneSet } from '../src';
import { BOX, SPAWN } from '../src/constants';
import { isSolid } from '../src/terrain';

test('loadZones parses the authored Field and Town from the repo-root zones/', () => {
	const zones = loadZones();
	const field = zones.find((z) => z.id === 'field-01');
	const town = zones.find((z) => z.id === 'town-01');

	expect(field?.type).toBe('field');
	expect(field?.spawns.length).toBeGreaterThan(0);
	expect(field?.monsters.length).toBe(field?.spawns.length);
	expect(field?.portals[0]?.target).toBe('town-01');

	expect(town?.type).toBe('town');
	expect(town?.spawns.length).toBe(0);
	expect(town?.npcs?.some((n) => n.kind === 'vendor')).toBe(true);
	expect(town?.portals[0]?.target).toBe('field-01');
});

test('the authored Zone set validates clean (the CI `zone check` invariant)', () => {
	const errors = validateZoneSet(loadZones(), CATALOGS).filter(
		(d) => d.severity === 'error',
	);
	expect(errors).toEqual([]);
});

test('round-trip portals: you can leave Town for the Field and return', () => {
	const zones = loadZones();
	const field = zones.find((z) => z.id === 'field-01');
	const town = zones.find((z) => z.id === 'town-01');
	expect(town?.portals.some((p) => p.target === 'field-01')).toBe(true);
	expect(field?.portals.some((p) => p.target === 'town-01')).toBe(true);
});

test('hub-and-spoke: Town portals to all three Fields, each returns to Town (D3, #239)', () => {
	const zones = loadZones();
	const town = zones.find((z) => z.id === 'town-01');
	for (const id of ['field-01', 'field-02', 'field-03']) {
		expect(town?.portals.some((p) => p.target === id)).toBe(true);
		const field = zones.find((z) => z.id === id);
		expect(field?.type).toBe('field');
		expect(field?.portals.some((p) => p.target === 'town-01')).toBe(true);
	}
});

test('difficulty rises with distance: pokers only Field 2+, Brute only in Field 3 (D3, #239)', () => {
	const behaviors = (id: string) =>
		new Set(
			loadZones()
				.find((z) => z.id === id)
				?.spawns.map((s) => s.type),
		);

	expect(behaviors('field-01')).toEqual(new Set(['chaser']));
	expect(behaviors('field-02').has('shooter')).toBe(true);
	expect(behaviors('field-02').has('brute')).toBe(false);
	expect(behaviors('field-03').has('brute')).toBe(true);
	expect(behaviors('field-03').has('shooter')).toBe(true);
});

test('the Dungeon is authored: a combat Zone entered from Town, round-tripping (D3, #240)', () => {
	const zones = loadZones();
	const dungeon = zones.find((z) => z.id === 'dungeon-01');
	const town = zones.find((z) => z.id === 'town-01');

	expect(dungeon?.type).toBe('dungeon');
	expect(dungeon?.spawns.length).toBeGreaterThan(0);
	expect(dungeon?.monsters.length).toBe(dungeon?.spawns.length);
	expect(town?.portals.some((p) => p.target === 'dungeon-01')).toBe(true);
	expect(dungeon?.portals.some((p) => p.target === 'town-01')).toBe(true);
});

test('Town has 2-3 signpost NPCs with directional dialogue (D3, #239)', () => {
	const town = loadZones().find((z) => z.id === 'town-01');
	const signs = (town?.npcs ?? []).filter((n) => n.kind === 'signpost');
	expect(signs.length).toBeGreaterThanOrEqual(2);
	expect(signs.length).toBeLessThanOrEqual(3);
	for (const s of signs) expect((s.lines ?? []).length).toBeGreaterThan(0);
});

test('the shared Player spawn point lands on walkable ground in the start Town', () => {
	const town = loadZones()[0];
	expect(town.id).toBe('town-01');
	const t = town.terrain;
	for (let y = SPAWN.y; y < SPAWN.y + BOX.h; y++)
		for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
			expect(isSolid(t, x, y)).toBe(false);
	let grounded = false;
	for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
		if (isSolid(t, x, SPAWN.y + BOX.h)) grounded = true;
	expect(grounded).toBe(true);
});
