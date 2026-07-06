import type { Item, PlayerProgress, Rarity, Slot } from './types';

const RARITY_VALUE: Record<Rarity, number> = {
	common: 5,
	uncommon: 12,
	rare: 30,
	epic: 75,
	legendary: 200,
};

const AFFIX_VALUE = 2;

export function saleValue(item: Item): number {
	const affixTotal = item.affixes.reduce((a, x) => a + x.value, 0);
	return RARITY_VALUE[item.rarity] + AFFIX_VALUE * affixTotal;
}

// The fixed shortlist a Town Merchant stocks (#242): plain, affix-free `common` goods a
// fresh Player can buy with early Gold — one per Slot so a starter can round out a kit.
// Every price sits ABOVE the common `saleValue` (5), so buying then re-selling is always
// a loss — the shop can never be farmed for free Gold.
export interface StarterGood {
	base: string;
	slot: Slot;
	price: number;
}
export const STARTER_GOODS: readonly StarterGood[] = [
	{ base: 'Rusty Sword', slot: 'weapon', price: 15 },
	{ base: 'Leather Vest', slot: 'armor', price: 15 },
	{ base: 'Copper Ring', slot: 'accessory', price: 20 },
];

/** Selling an id not held is a no-op, so a caller can't conjure Gold from an
 * item it doesn't own. */
export function sellItem(
	progress: PlayerProgress,
	inventory: Item[],
	itemId: number,
): { progress: PlayerProgress; inventory: Item[] } {
	const item = inventory.find((i) => i.id === itemId);
	if (!item) return { progress, inventory };
	return {
		progress: { ...progress, gold: progress.gold + saleValue(item) },
		inventory: inventory.filter((i) => i.id !== itemId),
	};
}

/** Buying a starter good round-trips Gold + inventory: it's refused (`bought: false`,
 * both unchanged) when the Player can't afford it, so a caller can never go into Gold
 * debt or conjure an Item for free. On success the price is deducted and a fresh
 * affix-free `common` Item — minted with the caller-supplied `itemId` — is appended.
 * The vendor never allocates ids; the caller passes its own unique source (`nextId`). */
export function buyItem(
	progress: PlayerProgress,
	inventory: Item[],
	good: StarterGood,
	itemId: number,
): { progress: PlayerProgress; inventory: Item[]; bought: boolean } {
	if (progress.gold < good.price) return { progress, inventory, bought: false };
	const item: Item = {
		id: itemId,
		base: good.base,
		slot: good.slot,
		rarity: 'common',
		affixes: [],
	};
	return {
		progress: { ...progress, gold: progress.gold - good.price },
		inventory: [...inventory, item],
		bought: true,
	};
}
