import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets/meta';
import type { Item, Npc } from '@mmo/core/entities';
import { STARTER_GOODS, saleValue } from '@mmo/core/items';
import { emptySave, restoredFromSave } from '@mmo/core/persistence';
import {
	addSession,
	createServerWorld,
	type ServerWorld,
	stepServerWorld,
	zoneInstance,
	zoneStateOf,
} from '@mmo/core/world';
import { applyBuy, applySell, atMerchant } from '../src/vendor';

function townWorld(): ServerWorld {
	return createServerWorld({
		zones: loadZones(),
		start: 'town-01',
		town: 'town-01',
	});
}

function zoneOrThrow(w: ServerWorld, zone: string) {
	const zs = zoneInstance(w, zone);
	if (!zs) throw new Error(`expected a shared instance of ${zone}`);
	return zs;
}

function avatarOf(w: ServerWorld, sessionId: number) {
	return zoneStateOf(w, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
}

const sellable = (over: Partial<Item> = {}): Item => ({
	id: 1,
	base: 'Rusty Sword',
	slot: 'weapon',
	rarity: 'rare',
	affixes: [{ stat: 'str', value: 3 }],
	...over,
});

function sellWorld(
	inventory: Item[],
	gold: number,
	standAtMerchant = true,
): { w: ServerWorld; merchant: Npc } {
	let w = townWorld();
	w = addSession(
		w,
		1,
		'neo',
		undefined,
		undefined,
		restoredFromSave({
			...emptySave('neo', 'town-01'),
			inventory,
			progress: { level: 2, xp: 0, gold },
		}),
	);
	const merchant = zoneOrThrow(w, 'town-01').zone.npcs?.find(
		(n) => n.kind === 'vendor',
	);
	if (!merchant) throw new Error('town-01 must have a Merchant');
	const x = standAtMerchant ? merchant.x : 0;
	w = stepServerWorld(
		w,
		[
			{
				sessionId: 1,
				x,
				y: merchant.y,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				attack: false,
			},
		],
		16,
	);
	return { w, merchant };
}

test('atMerchant is true standing on the Town Merchant, false when away', () => {
	expect(atMerchant(sellWorld([sellable()], 0).w, 1)).toBe(true);
	expect(atMerchant(sellWorld([sellable()], 0, false).w, 1)).toBe(false);
});

test('applySell removes the Item and credits its re-derived sale value to Gold', () => {
	const item = sellable({ id: 7 });
	const { w } = sellWorld(
		[item, sellable({ id: 8, base: 'Copper Ring' })],
		100,
	);
	const res = applySell(w, 1, 7);
	expect(res.sold).toBe(true);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([8]);
	expect(sa?.progress.gold).toBe(100 + saleValue(item));
	expect(sa?.log.at(-1)).toContain('Sold');
});

test('selling an unowned id is a no-op — Gold and inventory unchanged', () => {
	const { w } = sellWorld([sellable({ id: 7 })], 100);
	const res = applySell(w, 1, 999);
	expect(res.sold).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([7]);
	expect(sa?.progress.gold).toBe(100);
});

test('selling the same id twice: the second sell is a no-op (no double credit)', () => {
	const item = sellable({ id: 7 });
	const first = applySell(sellWorld([item], 0).w, 1, 7);
	expect(first.sold).toBe(true);
	const gold = avatarOf(first.world, 1)?.progress.gold;
	const second = applySell(first.world, 1, 7);
	expect(second.sold).toBe(false);
	expect(avatarOf(second.world, 1)?.progress.gold).toBe(gold);
});

test('a sell away from any Merchant is refused — never trust the client', () => {
	const { w } = sellWorld([sellable({ id: 7 })], 100, false);
	const res = applySell(w, 1, 7);
	expect(res.sold).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory.map((i) => i.id)).toEqual([7]);
	expect(sa?.progress.gold).toBe(100);
});

test('applySell for an unplaced session is a no-op', () => {
	const res = applySell(townWorld(), 999, 1);
	expect(res.sold).toBe(false);
});

test('applyBuy deducts the re-derived price, appends the good, and logs it', () => {
	const good = STARTER_GOODS[0];
	const { w } = sellWorld([], 100);
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(true);
	const sa = avatarOf(res.world, 1);
	expect(sa?.progress.gold).toBe(100 - good.price);
	const added = sa?.inventory.at(-1);
	expect(added?.base).toBe(good.base);
	expect(added?.slot).toBe(good.slot);
	expect(added?.rarity).toBe('common');
	expect(added?.affixes).toEqual([]);
	expect(sa?.log.at(-1)).toContain('Bought');
});

test('two buys mint distinct Item ids', () => {
	const { w } = sellWorld([], 100);
	const first = applyBuy(w, 1, 0);
	const second = applyBuy(first.world, 1, 0);
	expect(second.bought).toBe(true);
	const ids = avatarOf(second.world, 1)?.inventory.map((i) => i.id) ?? [];
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids.length).toBe(2);
});

test('buying when unaffordable is a no-op — Gold and inventory unchanged', () => {
	const good = STARTER_GOODS[0];
	const { w } = sellWorld([], good.price - 1);
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.progress.gold).toBe(good.price - 1);
	expect(sa?.inventory).toEqual([]);
});

test('buying an out-of-range catalog index is refused', () => {
	const { w } = sellWorld([], 1000);
	expect(applyBuy(w, 1, STARTER_GOODS.length).bought).toBe(false);
	expect(applyBuy(w, 1, -1).bought).toBe(false);
	expect(avatarOf(applyBuy(w, 1, 99).world, 1)?.progress.gold).toBe(1000);
});

test('a buy away from any Merchant is refused — never trust the client', () => {
	const { w } = sellWorld([], 1000, false);
	const res = applyBuy(w, 1, 0);
	expect(res.bought).toBe(false);
	const sa = avatarOf(res.world, 1);
	expect(sa?.inventory).toEqual([]);
	expect(sa?.progress.gold).toBe(1000);
});

test('applyBuy for an unplaced session is a no-op', () => {
	expect(applyBuy(townWorld(), 999, 0).bought).toBe(false);
});

test('round-trip buy then sell is always a net Gold loss', () => {
	for (let i = 0; i < STARTER_GOODS.length; i++) {
		const { w } = sellWorld([], 100);
		const boughtRes = applyBuy(w, 1, i);
		expect(boughtRes.bought).toBe(true);
		const minted = avatarOf(boughtRes.world, 1)?.inventory.at(-1);
		if (!minted) throw new Error('bought Item missing');
		const soldRes = applySell(boughtRes.world, 1, minted.id);
		expect(soldRes.sold).toBe(true);
		expect(avatarOf(soldRes.world, 1)?.progress.gold).toBeLessThan(100);
	}
});
