import { describe, expect, test } from 'bun:test';
import type { Item, PlayerProgress } from '../src/types';
import { saleValue, sellItem } from '../src/vendor';
import { makeFieldZone, makeTownZone } from '../src/world';

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
		expect(common).toBe(saleValue(item({ rarity: 'common' }))); // deterministic
		expect(legendary).toBeGreaterThan(common);
	});
});

const progress = (gold: number): PlayerProgress => ({ level: 3, xp: 50, gold });

describe('sellItem', () => {
	test('removes the Item and adds its sale value to Gold', () => {
		const sword = item({ id: 7, rarity: 'rare' });
		const ring = item({ id: 8, base: 'Copper Ring', slot: 'accessory' });
		const res = sellItem(progress(100), [sword, ring], 7);
		expect(res.inventory).toEqual([ring]); // sword gone
		expect(res.progress.gold).toBe(100 + saleValue(sword));
		expect(res.progress.level).toBe(3); // other progress untouched
	});

	test('cannot sell an Item not held — Gold and inventory unchanged', () => {
		const ring = item({ id: 8 });
		const res = sellItem(progress(100), [ring], 999); // 999 not in inventory
		expect(res.inventory).toEqual([ring]);
		expect(res.progress.gold).toBe(100);
	});
});

describe('vendor NPC placement', () => {
	test('the Town has a vendor NPC; the Field has none', () => {
		const town = makeTownZone('town-01');
		const field = makeFieldZone('field-01');
		expect(town.npcs?.some((n) => n.kind === 'vendor')).toBe(true);
		expect(field.npcs ?? []).toEqual([]); // combat Field is vendor-free
	});
});
