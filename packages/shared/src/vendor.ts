// vendor.ts — the Town NPC vendor economy (PRD story 29): a deterministic
// sale-value formula + the pure sell transaction. Selling is the Gold faucet
// that closes the loot → economy loop; the server owns Gold/inventory in M2, so
// the transaction lives here in @mmo/shared and runs once on either side.

import type { Item, PlayerProgress, Rarity } from './types';

// Sale value by rarity tier — the floor a drop is worth before its affixes.
const RARITY_VALUE: Record<Rarity, number> = {
	common: 5,
	uncommon: 12,
	rare: 30,
	epic: 75,
	legendary: 200,
};

// Gold added per point of total affix value — rewards higher-level / better-
// rolled drops without overtaking the rarity tier itself.
const AFFIX_VALUE = 2;

/** Gold an Item sells for: its rarity floor plus a bonus for affix magnitude.
 * Pure + deterministic — same Item always sells for the same Gold. */
export function saleValue(item: Item): number {
	const affixTotal = item.affixes.reduce((a, x) => a + x.value, 0);
	return RARITY_VALUE[item.rarity] + AFFIX_VALUE * affixTotal;
}

/** Sell the inventory Item with `itemId`: drop it from inventory and credit its
 * sale value to Gold. Pure — returns fresh progress + inventory, never mutates.
 * Selling an Item not held is a no-op (returns the inputs unchanged), so the
 * caller can't conjure Gold from an id it doesn't own. */
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
