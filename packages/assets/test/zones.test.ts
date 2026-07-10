// Zones leave @mmo/assets parsed (ADR 0033). Real-tree tests exercise the
// fs-scan strategy against the authored repo-root zones/; the *FromEntries
// tests inject an embedded-style map, proving the compiled-binary strategy
// without a bundler.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOX, isSolid, SPAWN, validateZoneSet } from '@mmo/core';
import {
	catalogsFromEntries,
	loadCatalogs,
	loadZones,
	zonesFromEntries,
} from '../src';
import { CATALOGS_JSON, FIELD_TEXT, TOWN_TEXT } from './fixtures';

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
	const errors = validateZoneSet(loadZones(), loadCatalogs()).filter(
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

// --- Embedded strategy, proven with an injected entries map. ---

describe('zonesFromEntries (the embedded-map strategy)', () => {
	test('parses every zones/*.zone against zones/catalogs.json, town first', () => {
		const zones = zonesFromEntries({
			'zones/f.zone': FIELD_TEXT, // sorts before t.zone — the Town must still lead
			'zones/t.zone': TOWN_TEXT,
			'zones/catalogs.json': CATALOGS_JSON,
			'sprites/hats/cap.sprite': 'not a zone', // other-kind entries are ignored
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

// --- The dev loop: a hand-edited .zone is picked up on re-read, no rebuild. ---

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
