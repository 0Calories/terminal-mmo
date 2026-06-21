import { describe, expect, test } from 'bun:test';
import { BOX, MONSTER, SHOOTER } from '../src/constants';
import {
	type MonsterCatalogEntry,
	type NpcCatalogEntry,
	parseZone,
	resolveMonster,
	resolveNpc,
	ZoneParseError,
} from '../src/zoneFormat';

const monsters: MonsterCatalogEntry[] = [
	{ id: 'goblin-01', behavior: 'chaser', name: 'Goblin' },
	{ id: 'archer-01', behavior: 'shooter', name: 'Archer' },
];
const npcs: NpcCatalogEntry[] = [
	{ id: 'merchant-01', kind: 'vendor', name: 'Merchant' },
];
const catalogs = { monsters, npcs };

// header + `---` + a 4-row grid: solid floor, two spawns, one portal, one npc.
const FIELD = `{ "id": "field-01", "type": "field",
  "spawns":  { "c": "goblin-01", "s": "archer-01" },
  "portals": { "a": { "target": "town-01", "arrival": [12, 32] } },
  "npcs":    { "m": "merchant-01" } }
---
..............
..c....s..a..m
##############
##############`;

describe('parseZone — happy path', () => {
	const zone = parseZone(FIELD, catalogs);

	test('header identity', () => {
		expect(zone.id).toBe('field-01');
		expect(zone.type).toBe('field');
	});

	test('dimensions inferred from the grid (h = rows, w = widest)', () => {
		expect(zone.terrain.h).toBe(4);
		expect(zone.terrain.w).toBe(14);
	});

	test('# is solid, everything else (incl. glyphs) is empty terrain', () => {
		const { w, cells } = zone.terrain;
		// floor rows fully solid
		expect(cells[2 * w + 0]).toBe(1);
		expect(cells[3 * w + 13]).toBe(1);
		// the spawn-glyph cell on row 1 is empty terrain
		expect(cells[1 * w + 2]).toBe(0);
		// a plain '.' is empty
		expect(cells[0 * w + 0]).toBe(0);
	});

	test('spawns + monsters derived in row-major order via spawnMonster', () => {
		expect(zone.spawns).toEqual([
			{ type: 'chaser', x: 2, y: 1 },
			{ type: 'shooter', x: 7, y: 1 },
		]);
		expect(zone.monsters).toHaveLength(2);
		const [c, s] = zone.monsters;
		// ids start at 2 (the Avatar is id 1)
		expect(c.id).toBe(2);
		expect(s.id).toBe(3);
		expect(c.type).toBe('chaser');
		expect(c.x).toBe(2);
		expect(c.y).toBe(1);
		expect(c.hp).toBe(MONSTER.chaserHp);
		expect(s.hp).toBe(SHOOTER.hp);
		expect(c.spawnIndex).toBe(0);
		expect(s.spawnIndex).toBe(1);
		expect(zone.nextMonsterId).toBe(4);
	});

	test('portal box is engine-derived (4×7) at its glyph cell', () => {
		expect(zone.portals).toEqual([
			{
				x: 10,
				y: 1,
				w: 4,
				h: 7,
				target: 'town-01',
				arrival: { x: 12, y: 32 },
			},
		]);
	});

	test('npc resolves from catalog with derived box + sequential id', () => {
		expect(zone.npcs).toEqual([
			{ id: 1, kind: 'vendor', name: 'Merchant', x: 13, y: 1, w: 4, h: BOX.h },
		]);
	});

	test('runtime state initialized like the factories', () => {
		expect(zone.projectiles).toEqual([]);
		expect(zone.nextProjectileId).toBe(1);
		expect(zone.respawns).toEqual([]);
	});

	test('deterministic — no RNG, parse twice is deep-equal', () => {
		expect(parseZone(FIELD, catalogs)).toEqual(parseZone(FIELD, catalogs));
	});
});

describe('parseZone — empty entity collections', () => {
	const BARE = `{ "id": "town-01", "type": "town" }
---
....
####`;
	const zone = parseZone(BARE, catalogs);

	test('no spawns/npcs/portals yields empty arrays and omitted npcs key', () => {
		expect(zone.monsters).toEqual([]);
		expect(zone.spawns).toEqual([]);
		expect(zone.portals).toEqual([]);
		expect(zone.npcs).toBeUndefined();
		expect(zone.nextMonsterId).toBe(2);
	});
});

describe('parseZone — fails safely', () => {
	const grid = `\n---\n....\n####`;

	test('missing --- delimiter', () => {
		expect(() =>
			parseZone('{ "id": "x", "type": "field" }\n....', catalogs),
		).toThrow(ZoneParseError);
	});

	test('malformed JSON header', () => {
		expect(() => parseZone(`{ "id": "x", "type": }${grid}`, catalogs)).toThrow(
			ZoneParseError,
		);
	});

	test('invalid zone type', () => {
		expect(() =>
			parseZone(`{ "id": "x", "type": "dungeon" }${grid}`, catalogs),
		).toThrow(ZoneParseError);
	});

	test('undeclared glyph in the grid', () => {
		const z = `{ "id": "x", "type": "field" }\n---\n.Z..\n####`;
		expect(() => parseZone(z, catalogs)).toThrow(/glyph/i);
	});

	test('spawn references a monster id absent from the catalog', () => {
		const z = `{ "id": "x", "type": "field", "spawns": { "c": "dragon-99" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs)).toThrow(ZoneParseError);
	});

	test('a glyph declared in two header maps', () => {
		const z = `{ "id": "x", "type": "field", "spawns": { "c": "goblin-01" }, "npcs": { "c": "merchant-01" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs)).toThrow(ZoneParseError);
	});

	test('reserved glyph (# or .) used as a header key', () => {
		const z = `{ "id": "x", "type": "field", "spawns": { "#": "goblin-01" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs)).toThrow(ZoneParseError);
	});

	test('oversize grid', () => {
		const wide = '.'.repeat(5000);
		expect(() =>
			parseZone(`{ "id": "x", "type": "field" }\n---\n${wide}`, catalogs),
		).toThrow(/large/i);
	});
});

describe('catalog resolvers', () => {
	test('resolveMonster / resolveNpc find by id', () => {
		expect(resolveMonster(monsters, 'archer-01').behavior).toBe('shooter');
		expect(resolveNpc(npcs, 'merchant-01').name).toBe('Merchant');
	});

	test('missing ids throw ZoneParseError', () => {
		expect(() => resolveMonster(monsters, 'nope')).toThrow(ZoneParseError);
		expect(() => resolveNpc(npcs, 'nope')).toThrow(ZoneParseError);
	});
});
