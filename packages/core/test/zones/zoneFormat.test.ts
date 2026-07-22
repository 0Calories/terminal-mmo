import { describe, expect, test } from 'bun:test';
import { ARCHETYPES } from '../../src/entities';
import {
	type MonsterCatalogEntry,
	NPC_BOX,
	type NpcCatalogEntry,
	PORTAL_BOX,
	parseZone,
	resolveMonster,
	resolveNpc,
	ZONE_MAX,
	ZoneParseError,
} from '../../src/zones';

const monsters: MonsterCatalogEntry[] = [
	{ id: 'test-chaser', behavior: 'chaser', name: 'Chaser' },
	{ id: 'test-shooter', behavior: 'shooter', name: 'Shooter' },
];
const npcs: NpcCatalogEntry[] = [
	{ id: 'test-vendor', kind: 'vendor', name: 'Vendor' },
];
const catalogs = { monsters, npcs };

const FIELD = `{ "type": "field", "name": "Test Field",
  "spawns":  { "c": "test-chaser", "s": "test-shooter" },
  "portals": { "a": { "target": "target-zone", "arrival": [12, 32] } },
  "npcs":    { "m": "test-vendor" } }
---
..............
..c....s..a..m
##############
##############`;

describe('Zone parsing laws', () => {
	const zone = parseZone(FIELD, catalogs, 'path-id');

	test('identity comes from the path while display name remains decorative', () => {
		expect(zone.id).toBe('path-id');
		expect(zone.name).toBe('Test Field');
		expect(parseZone(FIELD, catalogs, 'another-id').id).toBe('another-id');
	});

	test('grid dimensions and terrain cells are derived from authored rows', () => {
		expect(zone.terrain).toMatchObject({ w: 14, h: 4 });
		const { w, cells } = zone.terrain;
		expect(cells[2 * w]).toBe(1);
		expect(cells[3 * w + 13]).toBe(1);
		expect(cells[1 * w + 2]).toBe(0);
	});

	test('spawn glyphs resolve through the catalog in row-major order', () => {
		expect(zone.spawns).toEqual([
			{ type: 'chaser', x: 2, y: 1 },
			{ type: 'shooter', x: 7, y: 1 },
		]);
		expect(
			zone.monsters.map(({ id, type, x, y, hp, spawnIndex }) => ({
				id,
				type,
				x,
				y,
				hp,
				spawnIndex,
			})),
		).toEqual([
			{
				id: 2,
				type: 'chaser',
				x: 2,
				y: 1,
				hp: ARCHETYPES.chaser.hp,
				spawnIndex: 0,
			},
			{
				id: 3,
				type: 'shooter',
				x: 7,
				y: 1,
				hp: ARCHETYPES.shooter.hp,
				spawnIndex: 1,
			},
		]);
		expect(zone.nextMonsterId).toBe(2 + zone.monsters.length);
	});

	test('portal and NPC boxes use engine configuration', () => {
		expect(zone.portals).toEqual([
			{
				x: 10,
				y: 1,
				...PORTAL_BOX,
				target: 'target-zone',
				arrival: { x: 12, y: 32 },
			},
		]);
		expect(zone.npcs).toEqual([
			{ id: 1, kind: 'vendor', name: 'Vendor', x: 13, y: 1, ...NPC_BOX },
		]);
	});

	test('runtime-only collections initialize empty and parsing is deterministic', () => {
		expect(zone).toMatchObject({
			projectiles: [],
			nextProjectileId: 1,
			respawns: [],
		});
		expect(parseZone(FIELD, catalogs, 'path-id')).toEqual(zone);
	});

	test('omitted entity maps produce empty collections and no NPC property', () => {
		const bare = parseZone(
			'{"type":"town"}\n---\n....\n####',
			catalogs,
			'town',
		);
		expect(bare.monsters).toEqual([]);
		expect(bare.spawns).toEqual([]);
		expect(bare.portals).toEqual([]);
		expect(bare.npcs).toBeUndefined();
	});

	test('one-way platforms remain distinct from walls and empty cells', () => {
		const { terrain } = parseZone(
			'{"type":"field"}\n---\n..==..\n######',
			catalogs,
			'platforms',
		);
		expect(Array.from(terrain.cells)).toEqual([
			0, 0, 2, 2, 0, 0, 1, 1, 1, 1, 1, 1,
		]);
	});
});

describe('Zone parse failures', () => {
	const grid = '\n---\n....\n####';
	const failures = [
		['missing delimiter', '{"type":"field"}\n....', 'no-delimiter'],
		['malformed header JSON', `{"type":}${grid}`, 'bad-json'],
		['invalid Zone type', `{"type":"cave"}${grid}`, 'bad-header'],
		[
			'path-owned id in header',
			`{"id":"stale","type":"field"}${grid}`,
			'bad-header',
		],
		[
			'non-string display name',
			`{"type":"field","name":7}${grid}`,
			'bad-header',
		],
		['undeclared glyph', '{"type":"field"}\n---\n.Z..\n####', 'unknown-glyph'],
		[
			'unknown monster catalog id',
			'{"type":"field","spawns":{"c":"missing"}}\n---\n.c..\n####',
			'unknown-monster',
		],
		[
			'unknown NPC catalog id',
			'{"type":"field","npcs":{"n":"missing"}}\n---\n.n..\n####',
			'unknown-npc',
		],
		[
			'glyph declared in two maps',
			'{"type":"field","spawns":{"x":"test-chaser"},"npcs":{"x":"test-vendor"}}\n---\n.x..\n####',
			'bad-header',
		],
		[
			'grid beyond configured width cap',
			`{"type":"field"}\n---\n${'.'.repeat(ZONE_MAX.w + 1)}`,
			'too-large',
		],
	] as const;

	for (const [name, text, code] of failures) {
		test(name, () => {
			try {
				parseZone(text, catalogs, 'test-zone');
				throw new Error('expected parse failure');
			} catch (error) {
				expect(error).toBeInstanceOf(ZoneParseError);
				expect((error as ZoneParseError).code).toBe(code);
			}
		});
	}

	for (const glyph of ['#', '.', '=', ' '] as const) {
		test(`${JSON.stringify(glyph)} is reserved from header maps`, () => {
			const text = JSON.stringify({
				type: 'field',
				spawns: { [glyph]: 'test-chaser' },
			});
			expect(() => parseZone(`${text}${grid}`, catalogs, 'test-zone')).toThrow(
				ZoneParseError,
			);
		});
	}
});

test('catalog resolvers return matching entries and reject missing ids', () => {
	expect(resolveMonster(monsters, monsters[1].id)).toBe(monsters[1]);
	expect(resolveNpc(npcs, npcs[0].id)).toBe(npcs[0]);
	expect(() => resolveMonster(monsters, 'missing')).toThrow(ZoneParseError);
	expect(() => resolveNpc(npcs, 'missing')).toThrow(ZoneParseError);
});
