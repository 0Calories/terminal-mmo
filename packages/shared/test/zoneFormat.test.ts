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
// No `id` in the header — a Zone's identity is its filename (ADR 0011), passed
// to parseZone as the third argument.
const FIELD = `{ "type": "field",
  "spawns":  { "c": "goblin-01", "s": "archer-01" },
  "portals": { "a": { "target": "town-01", "arrival": [12, 32] } },
  "npcs":    { "m": "merchant-01" } }
---
..............
..c....s..a..m
##############
##############`;

describe('parseZone — happy path', () => {
	const zone = parseZone(FIELD, catalogs, 'field-01');

	test('identity comes from the filename arg, not the header', () => {
		expect(zone.id).toBe('field-01');
		expect(zone.type).toBe('field');
	});

	test('the same text parses under whatever id the path supplies', () => {
		expect(parseZone(FIELD, catalogs, 'verdant-meadow').id).toBe(
			'verdant-meadow',
		);
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
		expect(parseZone(FIELD, catalogs, 'field-01')).toEqual(
			parseZone(FIELD, catalogs, 'field-01'),
		);
	});
});

describe('parseZone — empty entity collections', () => {
	const BARE = `{ "type": "town" }
---
....
####`;
	const zone = parseZone(BARE, catalogs, 'town-01');

	test('no spawns/npcs/portals yields empty arrays and omitted npcs key', () => {
		expect(zone.monsters).toEqual([]);
		expect(zone.spawns).toEqual([]);
		expect(zone.portals).toEqual([]);
		expect(zone.npcs).toBeUndefined();
		expect(zone.nextMonsterId).toBe(2);
	});
});

describe('id is the filename, never the header (ADR 0011)', () => {
	const grid = `\n---\n....\n####`;

	test('a header carrying an id is rejected — identity-as-wrong is unrepresentable', () => {
		const text = `{ "id": "stale", "type": "field" }${grid}`;
		expect(() => parseZone(text, catalogs, 'field-01')).toThrow(ZoneParseError);
		expect(() => parseZone(text, catalogs, 'field-01')).toThrow(/id/i);
	});
});

describe('parseZone — fails safely', () => {
	const grid = `\n---\n....\n####`;

	test('missing --- delimiter', () => {
		expect(() => parseZone('{ "type": "field" }\n....', catalogs, 'x')).toThrow(
			ZoneParseError,
		);
	});

	test('malformed JSON header', () => {
		expect(() => parseZone(`{ "type": }${grid}`, catalogs, 'x')).toThrow(
			ZoneParseError,
		);
	});

	test('invalid zone type', () => {
		// 'field' | 'town' | 'dungeon' are the only accepted types (#240 added dungeon).
		expect(() => parseZone(`{ "type": "cave" }${grid}`, catalogs, 'x')).toThrow(
			ZoneParseError,
		);
	});

	test('undeclared glyph in the grid', () => {
		const z = `{ "type": "field" }\n---\n.Z..\n####`;
		expect(() => parseZone(z, catalogs, 'x')).toThrow(/glyph/i);
	});

	test('spawn references a monster id absent from the catalog', () => {
		const z = `{ "type": "field", "spawns": { "c": "dragon-99" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs, 'x')).toThrow(ZoneParseError);
	});

	test('a glyph declared in two header maps', () => {
		const z = `{ "type": "field", "spawns": { "c": "goblin-01" }, "npcs": { "c": "merchant-01" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs, 'x')).toThrow(ZoneParseError);
	});

	test('reserved glyph (# or .) used as a header key', () => {
		const z = `{ "type": "field", "spawns": { "#": "goblin-01" } }\n---\n.c..\n####`;
		expect(() => parseZone(z, catalogs, 'x')).toThrow(ZoneParseError);
	});

	test('oversize grid', () => {
		const wide = '.'.repeat(5000);
		expect(() =>
			parseZone(`{ "type": "field" }\n---\n${wide}`, catalogs, 'x'),
		).toThrow(/large/i);
	});
});

describe('optional display name (#99)', () => {
	test('header.name surfaces on the parsed Zone', () => {
		const text =
			'{ "type": "field", "name": "Sunny Meadow",\n  "spawns": { "c": "goblin-01" } }\n---\n..c..\n#####';
		expect(parseZone(text, catalogs, 'field-01').name).toBe('Sunny Meadow');
	});

	test('name is optional — absent leaves Zone.name undefined', () => {
		const text =
			'{ "type": "field", "spawns": { "c": "goblin-01" } }\n---\n..c..\n#####';
		expect(parseZone(text, catalogs, 'field-01').name).toBeUndefined();
	});

	test('a non-string name is a header error', () => {
		const text =
			'{ "type": "field", "name": 7, "spawns": { "c": "goblin-01" } }\n---\n..c..\n#####';
		expect(() => parseZone(text, catalogs, 'field-01')).toThrow(ZoneParseError);
		expect(() => parseZone(text, catalogs, 'field-01')).toThrow(/name/i);
	});

	test('name never resolves a Zone — it is decorative, distinct from id', () => {
		const text =
			'{ "type": "field", "name": "field-99",\n  "spawns": { "c": "goblin-01" } }\n---\n..c..\n#####';
		const zone = parseZone(text, catalogs, 'field-01');
		expect(zone.id).toBe('field-01');
		expect(zone.name).toBe('field-99');
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
