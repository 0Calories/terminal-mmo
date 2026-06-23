import { describe, expect, test } from 'bun:test';
import { BOX } from '../src/constants';
import type { Terrain } from '../src/types';
import type { Portal, Zone } from '../src/world';
import { parseZone } from '../src/zoneFormat';
import type { Diagnostic } from '../src/zoneValidate';
import {
	findOrphanGlyphs,
	validateZone,
	validateZoneSet,
} from '../src/zoneValidate';

const monsters = [
	{ id: 'goblin-01', behavior: 'chaser' as const, name: 'Goblin' },
	{ id: 'archer-01', behavior: 'shooter' as const, name: 'Archer' },
];
const npcs = [{ id: 'merchant-01', kind: 'vendor' as const, name: 'Merchant' }];
const catalogs = { monsters, npcs };

const W = 30;
const H = 12;
const FLOOR = 10; // rows 10,11 solid

function flatTerrain(): Terrain {
	const cells = new Uint8Array(W * H);
	for (let y = FLOOR; y < H; y++)
		for (let x = 0; x < W; x++) cells[y * W + x] = 1;
	return { w: W, h: H, cells };
}

const onGround = FLOOR - BOX.h; // y so a 5-tall box rests on the floor (rows 5..9)

function zone(over: Partial<Zone>): Zone {
	return {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [{ type: 'chaser', x: 2, y: onGround }],
		respawns: [],
		nextMonsterId: 2,
		portals: [],
		...over,
	};
}

const errs = (d: Diagnostic[]) => d.filter((x) => x.severity === 'error');
const warns = (d: Diagnostic[]) => d.filter((x) => x.severity === 'warning');

describe('validateZone — a well-formed Zone passes clean', () => {
	test('a grounded field spawn + npc + portal yields no errors', () => {
		const z = zone({
			npcs: [
				{
					id: 1,
					kind: 'vendor',
					name: 'Merchant',
					x: 20,
					y: onGround,
					w: 4,
					h: BOX.h,
				},
			],
			portals: [
				{
					x: 14,
					y: FLOOR - 7,
					w: 4,
					h: 7,
					target: 'town-01',
					arrival: { x: 5, y: onGround },
				},
			],
		});
		expect(errs(validateZone(z, catalogs))).toEqual([]);
	});

	test('a parseZone-built Zone validates clean (integration)', () => {
		const rows = Array.from({ length: H }, () => '.'.repeat(W).split(''));
		for (let x = 0; x < W; x++) {
			rows[10][x] = '#';
			rows[11][x] = '#';
		}
		rows[onGround][2] = 'c';
		rows[onGround][8] = 's';
		rows[onGround][20] = 'm';
		rows[FLOOR - 7][14] = 'a';
		const header = JSON.stringify({
			type: 'field',
			spawns: { c: 'goblin-01', s: 'archer-01' },
			npcs: { m: 'merchant-01' },
			portals: { a: { target: 'town-01', arrival: [5, onGround] } },
		});
		const z = parseZone(
			`${header}\n---\n${rows.map((r) => r.join('')).join('\n')}`,
			catalogs,
			'field-01',
		);
		expect(errs(validateZone(z, catalogs))).toEqual([]);
	});
});

describe('validateZone — zone-type rules', () => {
	test('a town with a spawn is an error', () => {
		const d = errs(validateZone(zone({ type: 'town' }), catalogs));
		expect(d).toHaveLength(1);
		expect(d[0].message).toMatch(/town/i);
	});

	test('a field with no spawn is an error', () => {
		const d = errs(validateZone(zone({ type: 'field', spawns: [] }), catalogs));
		expect(d.some((x) => /field/i.test(x.message))).toBe(true);
	});

	test('a town with no spawn is clean', () => {
		expect(
			errs(validateZone(zone({ type: 'town', spawns: [] }), catalogs)),
		).toEqual([]);
	});
});

describe('validateZone — placement & walkability', () => {
	test('a floating spawn (no ground beneath) is an error', () => {
		const d = errs(
			validateZone(
				zone({ spawns: [{ type: 'chaser', x: 2, y: 0 }] }),
				catalogs,
			),
		);
		expect(d.some((x) => /float/i.test(x.message))).toBe(true);
		expect(d[0].cell).toEqual({ x: 2, y: 0 });
	});

	test('a spawn embedded in solid terrain is an error', () => {
		// y=FLOOR-3: box rows 7..11 stay in-bounds but overlap solid rows 10,11
		const d = errs(
			validateZone(
				zone({ spawns: [{ type: 'chaser', x: 2, y: FLOOR - 3 }] }),
				catalogs,
			),
		);
		expect(d.some((x) => /solid/i.test(x.message))).toBe(true);
	});

	test('a box extending out of bounds is an error', () => {
		const d = errs(
			validateZone(
				zone({ spawns: [{ type: 'chaser', x: W - 1, y: onGround }] }),
				catalogs,
			),
		);
		expect(d.some((x) => /grid|bounds|outside/i.test(x.message))).toBe(true);
	});

	test('a floating npc is an error', () => {
		const z = zone({
			npcs: [
				{
					id: 1,
					kind: 'vendor',
					name: 'Merchant',
					x: 20,
					y: 0,
					w: 4,
					h: BOX.h,
				},
			],
		});
		expect(
			errs(validateZone(z, catalogs)).some((x) => /float/i.test(x.message)),
		).toBe(true);
	});

	test('a portal clipping solid terrain is an error', () => {
		// y=FLOOR-5: 7-tall box rows 5..11 stay in-bounds but overlap solid rows 10,11
		const z = zone({
			portals: [
				{
					x: 14,
					y: FLOOR - 5,
					w: 4,
					h: 7,
					target: 'town-01',
					arrival: { x: 5, y: onGround },
				},
			],
		});
		expect(
			errs(validateZone(z, catalogs)).some((x) => /solid/i.test(x.message)),
		).toBe(true);
	});
});

describe('validateZone — catalog integrity', () => {
	test('duplicate catalog ids are an error', () => {
		const dup = {
			monsters: [
				...monsters,
				{ id: 'goblin-01', behavior: 'chaser' as const, name: 'Dupe' },
			],
			npcs,
		};
		const d = errs(validateZone(zone({}), dup));
		expect(d.some((x) => /duplicate/i.test(x.message))).toBe(true);
	});
});

describe('validateZoneSet — whole-set integrity', () => {
	const portal = (target: string, arrival = { x: 5, y: onGround }): Portal => ({
		x: 14,
		y: FLOOR - 7,
		w: 4,
		h: 7,
		target,
		arrival,
	});

	test('a portal to an unknown Zone is an error', () => {
		const field = zone({ id: 'field-01', portals: [portal('nowhere-99')] });
		const d = errs(validateZoneSet([field], catalogs));
		expect(
			d.some((x) => /unknown/i.test(x.message) && x.zoneId === 'field-01'),
		).toBe(true);
	});

	test('an arrival landing in solid terrain is an error', () => {
		const field = zone({
			id: 'field-01',
			portals: [portal('town-01', { x: 5, y: FLOOR })],
		});
		const town = zone({
			id: 'town-01',
			type: 'town',
			spawns: [],
			portals: [portal('field-01')],
		});
		const d = errs(validateZoneSet([field, town], catalogs));
		expect(d.some((x) => /arrival/i.test(x.message))).toBe(true);
	});

	test('mutual portals validate clean (no one-way warning)', () => {
		const field = zone({ id: 'field-01', portals: [portal('town-01')] });
		const town = zone({
			id: 'town-01',
			type: 'town',
			spawns: [],
			portals: [portal('field-01')],
		});
		const all = validateZoneSet([field, town], catalogs);
		expect(errs(all)).toEqual([]);
		expect(warns(all)).toEqual([]);
	});

	test('a one-way portal is a warning, not an error', () => {
		const field = zone({ id: 'field-01', portals: [portal('town-01')] });
		const town = zone({ id: 'town-01', type: 'town', spawns: [], portals: [] });
		const all = validateZoneSet([field, town], catalogs);
		expect(errs(all)).toEqual([]);
		expect(warns(all).some((x) => /one-way|return/i.test(x.message))).toBe(
			true,
		);
	});
});

// Orphan-key detection reads the RAW .zone text (parseZone discards header glyph
// keys whose glyph never appears in the grid), so its fixtures are text, not Zones.
describe('findOrphanGlyphs — header keys must be used in the grid', () => {
	const grid = ['..........', '....c.....', '##########'].join('\n');
	const file = (header: string) => `${header}\n---\n${grid}`;

	test('a declared spawn glyph that never appears in the grid is an error', () => {
		const text = file('{"type":"field","spawns":{"c":"chaser","z":"chaser"}}');
		// The id is supplied by the caller (the filename, ADR 0011), not the header.
		const d = findOrphanGlyphs(text, 'f');
		expect(d).toHaveLength(1);
		expect(d[0].severity).toBe('error');
		expect(d[0].zoneId).toBe('f');
		expect(d[0].message).toContain("'z'");
	});

	test('a file whose every declared glyph is placed has no orphans', () => {
		const text = file('{"type":"field","spawns":{"c":"chaser"}}');
		expect(findOrphanGlyphs(text)).toEqual([]);
	});

	test('orphan npc and portal keys are flagged too', () => {
		const text = file(
			'{"type":"field","spawns":{"c":"chaser"},' +
				'"npcs":{"M":"merchant"},' +
				'"portals":{"P":{"target":"town-01","arrival":[1,1]}}}',
		);
		const d = findOrphanGlyphs(text);
		expect(d).toHaveLength(2); // M and P never appear in the grid
		expect(d.map((x) => x.message).join(' ')).toContain("'M'");
		expect(d.map((x) => x.message).join(' ')).toContain("'P'");
		expect(d.every((x) => x.severity === 'error')).toBe(true);
	});

	test('a malformed file (no delimiter / bad JSON header) yields nothing', () => {
		expect(findOrphanGlyphs('{} no delimiter here')).toEqual([]);
		expect(findOrphanGlyphs('{not json\n---\n....')).toEqual([]);
	});
});
