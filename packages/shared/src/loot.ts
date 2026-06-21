import { rngNext } from './rng';
import type { Item, ItemAffix, Rarity, Slot } from './types';

interface BaseType {
	name: string;
	slot: Slot;
}
export const BASES: BaseType[] = [
	{ name: 'Rusty Sword', slot: 'weapon' },
	{ name: 'Iron Sword', slot: 'weapon' },
	{ name: 'Leather Vest', slot: 'armor' },
	{ name: 'Chain Mail', slot: 'armor' },
	{ name: 'Copper Ring', slot: 'accessory' },
	{ name: 'Jade Amulet', slot: 'accessory' },
];

interface RarityDef {
	name: Rarity;
	weight: number;
	affixes: number;
}
export const RARITIES: RarityDef[] = [
	{ name: 'common', weight: 60, affixes: 1 },
	{ name: 'uncommon', weight: 25, affixes: 2 },
	{ name: 'rare', weight: 10, affixes: 3 },
	{ name: 'epic', weight: 4, affixes: 4 },
	{ name: 'legendary', weight: 1, affixes: 5 },
];

export const AFFIXES = ['str', 'dex', 'int', 'hp', 'crit', 'haste'];

/** Threads RNG state. Returned item.id is 0; callers assign a real id. */
export function rollItem(
	state: number,
	level: number,
): { item: Item; state: number } {
	let r = rngNext(state);
	state = r.state;
	const total = RARITIES.reduce((a, b) => a + b.weight, 0);
	let roll = r.value * total;
	let rar = RARITIES[0];
	for (const x of RARITIES) {
		if (roll < x.weight) {
			rar = x;
			break;
		}
		roll -= x.weight;
	}

	r = rngNext(state);
	state = r.state;
	const base = BASES[Math.floor(r.value * BASES.length)];

	const affixes: ItemAffix[] = [];
	for (let i = 0; i < rar.affixes; i++) {
		r = rngNext(state);
		state = r.state;
		const stat = AFFIXES[Math.floor(r.value * AFFIXES.length)];
		r = rngNext(state);
		state = r.state;
		const value = 1 + Math.floor(r.value * (level + 1));
		affixes.push({ stat, value });
	}

	return {
		item: {
			id: 0,
			base: base.name,
			slot: base.slot,
			rarity: rar.name,
			affixes,
		},
		state,
	};
}
