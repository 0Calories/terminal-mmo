import { describe, expect, test } from 'bun:test';
import { BOX, type Terrain } from '../../src/entities';
import type { Portal, Zone } from '../../src/zones';
import {
	type Diagnostic,
	findOrphanGlyphs,
	validateZone,
	validateZoneSet,
} from '../../src/zones';

const monsters = [
	{ id: 'test-chaser', behavior: 'chaser' as const, name: 'Chaser' },
];
const npcs = [{ id: 'test-vendor', kind: 'vendor' as const, name: 'Vendor' }];
const catalogs = { monsters, npcs };

const W = 30;
const H = 12;
const FLOOR = 10;
const GROUND_Y = FLOOR - BOX.h;

function flatTerrain(): Terrain {
	const cells = new Uint8Array(W * H);
	for (let y = FLOOR; y < H; y++)
		for (let x = 0; x < W; x++) cells[y * W + x] = 1;
	return { w: W, h: H, cells };
}

function zone(overrides: Partial<Zone> = {}): Zone {
	return {
		id: 'field-a',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [{ type: 'chaser', x: 2, y: GROUND_Y }],
		respawns: [],
		nextMonsterId: 2,
		portals: [],
		...overrides,
	};
}

function portal(target: string, arrival = { x: 5, y: GROUND_Y }): Portal {
	return {
		x: 14,
		y: FLOOR - 7,
		w: 4,
		h: 7,
		target,
		arrival,
	};
}

const errors = (diagnostics: Diagnostic[]) =>
	diagnostics.filter(({ severity }) => severity === 'error');
const warnings = (diagnostics: Diagnostic[]) =>
	diagnostics.filter(({ severity }) => severity === 'warning');

describe('per-Zone validation', () => {
	test('a grounded field spawn, NPC, and portal are clean', () => {
		const valid = zone({
			npcs: [
				{
					id: 1,
					kind: 'vendor',
					name: 'Vendor',
					x: 20,
					y: GROUND_Y,
					w: 4,
					h: BOX.h,
				},
			],
			portals: [portal('unresolved-until-set-validation')],
		});
		expect(errors(validateZone(valid, catalogs))).toEqual([]);
	});

	for (const [name, candidate, pattern] of [
		['town with a monster spawn', zone({ type: 'town' }), /town/i],
		['field without a monster spawn', zone({ spawns: [] }), /field/i],
		[
			'floating spawn',
			zone({ spawns: [{ type: 'chaser', x: 2, y: 0 }] }),
			/float/i,
		],
		[
			'spawn embedded in terrain',
			zone({ spawns: [{ type: 'chaser', x: 2, y: FLOOR - 3 }] }),
			/solid/i,
		],
		[
			'spawn extending beyond bounds',
			zone({ spawns: [{ type: 'chaser', x: W - 1, y: GROUND_Y }] }),
			/grid|bounds|outside/i,
		],
		[
			'floating NPC',
			zone({
				npcs: [
					{
						id: 1,
						kind: 'vendor',
						name: 'Vendor',
						x: 20,
						y: 0,
						w: 4,
						h: BOX.h,
					},
				],
			}),
			/float/i,
		],
		[
			'portal clipping terrain',
			zone({ portals: [{ ...portal('target'), y: FLOOR - 5 }] }),
			/solid/i,
		],
	] as const) {
		test(`${name} is rejected`, () => {
			const diagnostics = errors(validateZone(candidate, catalogs));
			expect(diagnostics.some(({ message }) => pattern.test(message))).toBe(
				true,
			);
		});
	}

	test('a town without monster spawns is clean', () => {
		expect(
			errors(validateZone(zone({ type: 'town', spawns: [] }), catalogs)),
		).toEqual([]);
	});

	test('duplicate ids in either catalog are rejected', () => {
		for (const duplicateCatalogs of [
			{ monsters: [...monsters, monsters[0]], npcs },
			{ monsters, npcs: [...npcs, npcs[0]] },
		]) {
			expect(
				errors(validateZone(zone(), duplicateCatalogs)).some(({ message }) =>
					/duplicate/i.test(message),
				),
			).toBe(true);
		}
	});
});

describe('whole-set validation', () => {
	test('unknown targets and invalid arrival placement are errors', () => {
		const cases = [
			{
				zones: [zone({ portals: [portal('missing')] })],
				pattern: /unknown/i,
			},
			{
				zones: [
					zone({ portals: [portal('town', { x: 5, y: FLOOR })] }),
					zone({
						id: 'town',
						type: 'town',
						spawns: [],
						portals: [portal('field-a')],
					}),
				],
				pattern: /arrival/i,
			},
			{
				zones: [
					zone({ portals: [portal('town', { x: W, y: GROUND_Y })] }),
					zone({
						id: 'town',
						type: 'town',
						spawns: [],
						portals: [portal('field-a')],
					}),
				],
				pattern: /arrival/i,
			},
		] as const;

		for (const { zones, pattern } of cases)
			expect(
				errors(validateZoneSet([...zones], catalogs)).some(({ message }) =>
					pattern.test(message),
				),
			).toBe(true);
	});

	test('mutual portals are clean while a one-way link is warning-only', () => {
		const field = zone({ portals: [portal('town')] });
		const town = zone({
			id: 'town',
			type: 'town',
			spawns: [],
			portals: [portal('field-a')],
		});
		const mutual = validateZoneSet([field, town], catalogs);
		expect(errors(mutual)).toEqual([]);
		expect(warnings(mutual)).toEqual([]);

		const oneWay = validateZoneSet([field, { ...town, portals: [] }], catalogs);
		expect(errors(oneWay)).toEqual([]);
		expect(
			warnings(oneWay).some(({ message }) => /one-way|return/i.test(message)),
		).toBe(true);
	});
});

describe('orphan glyph validation', () => {
	const grid = ['..........', '....c.....', '##########'].join('\n');
	const file = (header: object) => `${JSON.stringify(header)}\n---\n${grid}`;

	test('every unused declared entity glyph is reported', () => {
		const diagnostics = findOrphanGlyphs(
			file({
				type: 'field',
				spawns: { c: 'test-chaser', z: 'test-chaser' },
				npcs: { n: 'test-vendor' },
				portals: { p: { target: 'town', arrival: [1, 1] } },
			}),
			'field-a',
		);
		expect(diagnostics.map(({ message }) => message)).toEqual(
			expect.arrayContaining([
				expect.stringContaining("'z'"),
				expect.stringContaining("'n'"),
				expect.stringContaining("'p'"),
			]),
		);
		expect(
			diagnostics.every(
				({ severity, zoneId }) => severity === 'error' && zoneId === 'field-a',
			),
		).toBe(true);
	});

	test('fully used headers and malformed documents produce no orphan diagnostics', () => {
		expect(
			findOrphanGlyphs(file({ type: 'field', spawns: { c: 'test-chaser' } })),
		).toEqual([]);
		expect(findOrphanGlyphs('{} no delimiter')).toEqual([]);
		expect(findOrphanGlyphs('{not json\n---\n....')).toEqual([]);
	});
});
