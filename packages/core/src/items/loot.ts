import { type RGBAQuad, STANDARD_PALETTE } from '../entities/sceneStyle';
import type { Item, ItemAffix, Rarity, Slot } from '../entities/types';
import { rngNext } from './rng';

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

export interface RarityDef {
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

export const RARITY_COLOR: Record<Rarity, RGBAQuad> = {
	common: STANDARD_PALETTE.s,
	uncommon: STANDARD_PALETTE.f,
	rare: STANDARD_PALETTE.b,
	epic: STANDARD_PALETTE.v,
	legendary: STANDARD_PALETTE.p,
};

export interface LootTable {
	bases: string[];
	dropChance: number;
	rarities?: RarityDef[];
}

export const DEFAULT_LOOT_TABLE: LootTable = {
	bases: BASES.map((b) => b.name),
	dropChance: 1,
};

const RICH_RARITIES: RarityDef[] = [
	{ name: 'common', weight: 40, affixes: 1 },
	{ name: 'uncommon', weight: 30, affixes: 2 },
	{ name: 'rare', weight: 18, affixes: 3 },
	{ name: 'epic', weight: 9, affixes: 4 },
	{ name: 'legendary', weight: 3, affixes: 5 },
];

export const LOOT_TABLES: Record<string, LootTable> = {
	'field-01': {
		bases: ['Rusty Sword', 'Leather Vest', 'Copper Ring'],
		dropChance: 0.4,
	},
	'field-02': {
		bases: ['Rusty Sword', 'Iron Sword', 'Leather Vest', 'Chain Mail'],
		dropChance: 0.45,
	},
	'field-03': {
		bases: BASES.map((b) => b.name),
		dropChance: 0.5,
		rarities: RICH_RARITIES,
	},
	'dungeon-01': {
		bases: BASES.map((b) => b.name),
		dropChance: 1,
		rarities: RICH_RARITIES,
	},
};

for (const [id, table] of Object.entries(LOOT_TABLES))
	for (const name of table.bases)
		if (!BASES.some((b) => b.name === name))
			throw new Error(`loot table '${id}' references unknown base '${name}'`);

export function lootTableFor(zoneId: string): LootTable {
	return LOOT_TABLES[zoneId] ?? DEFAULT_LOOT_TABLE;
}

export function itemLabel(item: Pick<Item, 'rarity' | 'base'>): string {
	return `${item.rarity} ${item.base}`;
}

export function rollItem(
	state: number,
	level: number,
	table: LootTable = DEFAULT_LOOT_TABLE,
): { item: Item; state: number } {
	const rarities = table.rarities ?? RARITIES;
	let r = rngNext(state);
	state = r.state;
	const total = rarities.reduce((a, b) => a + b.weight, 0);
	let roll = r.value * total;
	let rar = rarities[0];
	for (const x of rarities) {
		if (roll < x.weight) {
			rar = x;
			break;
		}
		roll -= x.weight;
	}

	r = rngNext(state);
	state = r.state;
	const base = baseByName(
		table.bases[Math.floor(r.value * table.bases.length)],
	);

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

export function rollDrop(
	state: number,
	level: number,
	table: LootTable = DEFAULT_LOOT_TABLE,
): { item: Item | null; state: number } {
	const r = rngNext(state);
	state = r.state;
	if (r.value >= table.dropChance) return { item: null, state };
	return rollItem(state, level, table);
}

function baseByName(name: string): BaseType {
	return BASES.find((b) => b.name === name) ?? BASES[0];
}
