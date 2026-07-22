import { describe, expect, test } from 'bun:test';
import {
	BASES,
	DEFAULT_LOOT_TABLE,
	itemLabel,
	LOOT_TABLES,
	lootTableFor,
	RARITIES,
	RARITY_COLOR,
	rollDrop,
	rollItem,
} from '../../src/items';

describe('deterministic loot generation laws', () => {
	test('the same seed and configuration produce the same Item and next state', () => {
		const first = rollItem(123, 5);
		const second = rollItem(123, 5);
		expect(second).toEqual(first);
	});

	test('a generated Item belongs to its configured base and rarity definitions', () => {
		for (const seed of [1, 7, 123, 999]) {
			const { item } = rollItem(seed, 10);
			const rarity = RARITIES.find(
				(candidate) => candidate.name === item.rarity,
			);
			const base = BASES.find((candidate) => candidate.name === item.base);
			if (!rarity || !base)
				throw new Error('roll escaped configured loot data');
			expect(item.affixes).toHaveLength(rarity.affixes);
			expect(item.slot).toBe(base.slot);
		}
	});

	test('seed threading produces a deterministic but non-constant stream', () => {
		const stream = (seed: number) => {
			let state = seed;
			return Array.from({ length: 12 }, () => {
				const result = rollItem(state, 5);
				state = result.state;
				return result.item;
			});
		};
		expect(stream(17)).toEqual(stream(17));
		expect(new Set(stream(17).map((item) => item.base)).size).toBeGreaterThan(
			1,
		);
	});

	test('drop and no-drop paths both advance deterministically', () => {
		const base = DEFAULT_LOOT_TABLE.bases.slice(0, 1);
		for (const [dropChance, drops] of [
			[1, true],
			[0, false],
		] as const) {
			const table = { bases: base, dropChance };
			const first = rollDrop(42, 5, table);
			const second = rollDrop(42, 5, table);
			expect(second).toEqual(first);
			expect(first.state).not.toBe(42);
			expect(first.item !== null).toBe(drops);
		}
	});
});

describe('configured loot integrity', () => {
	test('every Zone table references configured bases and unknown Zones use the default', () => {
		const bases = new Set(BASES.map((base) => base.name));
		for (const [zoneId, table] of Object.entries(LOOT_TABLES)) {
			expect(lootTableFor(zoneId)).toBe(table);
			expect(table.bases.length).toBeGreaterThan(0);
			for (const base of table.bases) expect(bases.has(base)).toBe(true);
		}
		expect(lootTableFor('unconfigured-zone')).toBe(DEFAULT_LOOT_TABLE);
	});

	test('a supplied table constrains every roll to its own base pool', () => {
		const table = {
			bases: DEFAULT_LOOT_TABLE.bases.slice(0, 2),
			dropChance: 1,
		};
		let state = 5;
		for (let i = 0; i < 40; i++) {
			const result = rollItem(state, 8, table);
			state = result.state;
			expect(table.bases).toContain(result.item.base);
		}
	});

	test('every configured rarity has a valid distinct presentation colour', () => {
		const colors = RARITIES.map(({ name }) => {
			const color = RARITY_COLOR[name];
			for (const channel of color.slice(0, 3)) {
				expect(channel).toBeGreaterThanOrEqual(0);
				expect(channel).toBeLessThanOrEqual(255);
			}
			return color.join(',');
		});
		expect(new Set(colors).size).toBe(colors.length);
	});

	test('Item labels are derived from the authored rarity and base', () => {
		const { item } = rollItem(7, 5);
		expect(itemLabel(item)).toBe(`${item.rarity} ${item.base}`);
	});
});
