import { expect, test } from 'bun:test';
import { CATALOGS, loadZones, validateZoneSet } from '../src';

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
