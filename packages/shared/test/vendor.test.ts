import { describe, expect, test } from 'bun:test';
import type { Item, PlayerProgress } from '../src/types';
import { buyItem, STARTER_GOODS, saleValue, sellItem } from '../src/vendor';
import { loadZones } from '../src/zoneContent';

const item = (over: Partial<Item> = {}): Item => ({
	id: 1,
	base: 'Rusty Sword',
	slot: 'weapon',
	rarity: 'common',
	affixes: [],
	...over,
});

describe('saleValue', () => {
	test('is deterministic and rises with rarity', () => {
		const common = saleValue(item({ rarity: 'common' }));
		const legendary = saleValue(item({ rarity: 'legendary' }));
		expect(common).toBe(saleValue(item({ rarity: 'common' })));
		expect(legendary).toBeGreaterThan(common);
	});
});

const progress = (gold: number): PlayerProgress => ({ level: 3, xp: 50, gold });

describe('sellItem', () => {
	test('removes the Item and adds its sale value to Gold', () => {
		const sword = item({ id: 7, rarity: 'rare' });
		const ring = item({ id: 8, base: 'Copper Ring', slot: 'accessory' });
		const res = sellItem(progress(100), [sword, ring], 7);
		expect(res.inventory).toEqual([ring]);
		expect(res.progress.gold).toBe(100 + saleValue(sword));
		expect(res.progress.level).toBe(3); // other progress untouched
	});

	test('cannot sell an Item not held — Gold and inventory unchanged', () => {
		const ring = item({ id: 8 });
		const res = sellItem(progress(100), [ring], 999);
		expect(res.inventory).toEqual([ring]);
		expect(res.progress.gold).toBe(100);
	});
});

describe('buyItem', () => {
	const good = STARTER_GOODS[0]; // Rusty Sword, price 15

	test('deducts the price and appends the bought Item with the given id', () => {
		const res = buyItem(progress(100), [], good, 42);
		expect(res.bought).toBe(true);
		expect(res.progress.gold).toBe(100 - good.price);
		expect(res.progress.level).toBe(3); // other progress untouched
		expect(res.inventory).toHaveLength(1);
		expect(res.inventory[0]).toEqual({
			id: 42,
			base: good.base,
			slot: good.slot,
			rarity: 'common',
			affixes: [],
		});
	});

	test('cannot buy without enough Gold — Gold and inventory unchanged', () => {
		const ring = item({ id: 8 });
		const res = buyItem(progress(good.price - 1), [ring], good, 42);
		expect(res.bought).toBe(false);
		expect(res.progress.gold).toBe(good.price - 1);
		expect(res.inventory).toEqual([ring]);
	});

	test('buying exactly to zero Gold succeeds', () => {
		const res = buyItem(progress(good.price), [], good, 1);
		expect(res.bought).toBe(true);
		expect(res.progress.gold).toBe(0);
	});

	test('buy then sell round-trips at a loss — the shop is not free Gold', () => {
		const bought = buyItem(progress(50), [], good, 1);
		const sold = sellItem(bought.progress, bought.inventory, 1);
		expect(sold.inventory).toEqual([]);
		expect(sold.progress.gold).toBeLessThan(50); // price > sale value
	});

	test('every starter good is a common, affix-free base priced above its sale value', () => {
		for (const g of STARTER_GOODS) {
			const minted = buyItem(progress(g.price), [], g, 1).inventory[0];
			expect(minted.rarity).toBe('common');
			expect(minted.affixes).toEqual([]);
			expect(g.price).toBeGreaterThan(saleValue(minted));
		}
	});
});

describe('vendor NPC placement', () => {
	test('the Town has a vendor NPC; the Field has none', () => {
		const zones = loadZones();
		const town = zones.find((z) => z.id === 'town-01');
		const field = zones.find((z) => z.id === 'field-01');
		expect(town?.npcs?.some((n) => n.kind === 'vendor')).toBe(true);
		expect(field?.npcs ?? []).toEqual([]); // combat Field is vendor-free
	});
});
