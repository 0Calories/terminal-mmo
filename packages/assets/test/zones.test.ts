import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOX } from '@mmo/core/entities';
import { isSolid } from '@mmo/core/physics';
import { SPAWN, validateZoneSet } from '@mmo/core/zones';
import {
	catalogsFromEntries,
	loadCatalogs,
	loadZones,
	zonesFromEntries,
} from '../src';
import { CATALOGS_JSON, FIELD_TEXT, TOWN_TEXT } from './fixtures';

test('loadZones parses every authored Zone kind and initializes placed entities', () => {
	const zones = loadZones();
	const field = zones.find((zone) => zone.type === 'field');
	const town = zones.find((zone) => zone.type === 'town');
	const dungeon = zones.find((zone) => zone.type === 'dungeon');

	expect(field?.spawns.length).toBeGreaterThan(0);
	expect(field?.monsters.length).toBe(field?.spawns.length);
	expect(town?.spawns.length).toBe(0);
	expect(town?.npcs?.some((n) => n.kind === 'vendor')).toBe(true);
	expect(dungeon?.monsters.length).toBe(dungeon?.spawns.length);
});

test('the authored Zone set validates clean (the CI `zone check` invariant)', () => {
	const errors = validateZoneSet(loadZones(), loadCatalogs()).filter(
		(d) => d.severity === 'error',
	);
	expect(errors).toEqual([]);
});

test('authored Portal targets resolve and include a round trip from Town', () => {
	const zones = loadZones();
	const byId = new Map(zones.map((zone) => [zone.id, zone]));
	for (const zone of zones)
		for (const portal of zone.portals)
			expect(byId.has(portal.target)).toBe(true);

	const town = zones.find((zone) => zone.type === 'town');
	if (!town) throw new Error('expected an authored Town');
	const destination = town.portals
		.map((portal) => byId.get(portal.target))
		.find((zone) => zone?.portals.some((portal) => portal.target === town.id));
	expect(destination).toBeDefined();
});

test('the shared Player spawn point lands on walkable ground in the start Town', () => {
	const town = loadZones()[0];
	expect(town.type).toBe('town');
	const t = town.terrain;
	for (let y = SPAWN.y; y < SPAWN.y + BOX.h; y++)
		for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
			expect(isSolid(t, x, y)).toBe(false);
	let grounded = false;
	for (let x = SPAWN.x; x < SPAWN.x + BOX.w; x++)
		if (isSolid(t, x, SPAWN.y + BOX.h)) grounded = true;
	expect(grounded).toBe(true);
});

describe('zonesFromEntries (the embedded-map strategy)', () => {
	test('parses every zones/*.zone against zones/catalogs.json, town first', () => {
		const zones = zonesFromEntries({
			'zones/f.zone': FIELD_TEXT,
			'zones/t.zone': TOWN_TEXT,
			'zones/catalogs.json': CATALOGS_JSON,
			'sprites/hats/cap.sprite': 'not a zone',
		});
		expect(zones.map((z) => z.id)).toEqual(['t', 'f']);
		expect(zones[0].type).toBe('town');
		expect(zones[1].spawns[0]?.type).toBe('chaser');
	});

	test('missing catalogs.json degrades to empty catalogs, not a crash', () => {
		expect(catalogsFromEntries({})).toEqual({ monsters: [], npcs: [] });
		const zones = zonesFromEntries({ 'zones/t.zone': TOWN_TEXT });
		expect(zones.map((z) => z.id)).toEqual(['t']);
	});
});

describe('loadZones (fs-scan strategy)', () => {
	const cleanupDirs: string[] = [];
	let savedCwd: string | undefined;

	afterEach(() => {
		if (savedCwd) {
			process.chdir(savedCwd);
			savedCwd = undefined;
		}
		for (const dir of cleanupDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('re-reads the zones/ tree on every call: a hand edit shows up without a rebuild', () => {
		const dir = mkdtempSync(join(tmpdir(), 'assets-zones-'));
		cleanupDirs.push(dir);
		mkdirSync(join(dir, 'zones'));
		writeFileSync(join(dir, 'zones', 'catalogs.json'), CATALOGS_JSON);
		writeFileSync(join(dir, 'zones', 't.zone'), TOWN_TEXT);

		savedCwd = process.cwd();
		process.chdir(dir);

		expect(loadZones().map((z) => z.id)).toEqual(['t']);

		writeFileSync(join(dir, 'zones', 'f.zone'), FIELD_TEXT);
		expect(loadZones().map((z) => z.id)).toEqual(['t', 'f']);
	});
});
