import type { Item, PlayerProgress, Rarity } from './types';

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
