import { expect, test } from 'bun:test';
import { CATALOGS, loadZones, validateZoneSet } from '../src';
import { BOX, GROUND_TOP, SPAWN } from '../src/constants';
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

test('Field is a deliberate platforming course: a chaser+shooter mix on raised platforms', () => {
	const field = loadZones().find((z) => z.id === 'field-01');
	if (!field) throw new Error('field-01 missing');

	// A genuine encounter mix, not a single token monster of each kind.
	const chasers = field.spawns.filter((s) => s.type === 'chaser');
	const shooters = field.spawns.filter((s) => s.type === 'shooter');
	expect(chasers.length).toBeGreaterThanOrEqual(2);
	expect(shooters.length).toBeGreaterThanOrEqual(2);

	// Deliberate verticality: solid terrain well above the floor band (raised
	// platforms), not just the flat world floor.
	const t = field.terrain;
	let raised = 0;
	for (let y = 0; y < GROUND_TOP - 2; y++)
		for (let x = 0; x < t.w; x++) if (t.cells[y * t.w + x] === 1) raised++;
	expect(raised).toBeGreaterThan(0);

	// Some monster is perched on a platform (anchored above the floor), so the
	// player must climb to fight it — not all on the ground.
	expect(field.spawns.some((s) => s.y < SPAWN.y)).toBe(true);
});

test('round-trip portals: you can leave Town for the Field and return', () => {
	const zones = loadZones();
	const field = zones.find((z) => z.id === 'field-01');
	const town = zones.find((z) => z.id === 'town-01');
	expect(town?.portals.some((p) => p.target === 'field-01')).toBe(true);
	expect(field?.portals.some((p) => p.target === 'town-01')).toBe(true);
});

test('the shared Player spawn point lands on walkable ground in the start Field', () => {
	// createGame drops the Player at SPAWN in the first Zone (the Field); that cell
	// must be clear and rest on solid ground or the game opens mid-air / in a wall.
	const field = loadZones()[0];
	expect(field.id).toBe('field-01');
	const t = field.terrain;
	for (let y = SPAWN.y; y < SPAWN.y + BOX.h; y++)
		for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
			expect(isSolid(t, x, y)).toBe(false);
	let grounded = false;
	for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
		if (isSolid(t, x, SPAWN.y + BOX.h)) grounded = true;
	expect(grounded).toBe(true);
});
