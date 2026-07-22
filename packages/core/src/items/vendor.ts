import type { Item, PlayerProgress, Rarity, Slot } from '../entities/types';

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
