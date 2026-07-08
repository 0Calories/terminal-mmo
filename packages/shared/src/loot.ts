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

// Rarity → colour, the one shared source both the in-world Drop glyph and the on-pickup
// readout paint from, so a tier reads identically everywhere. RGB (0–255) to feed both the
// shared renderer and the client theme.
export const RARITY_COLOR: Record<Rarity, { r: number; g: number; b: number }> =
	{
		common: { r: 176, g: 184, b: 196 },
		uncommon: { r: 96, g: 210, b: 122 },
		rare: { r: 92, g: 158, b: 255 },
		epic: { r: 190, g: 120, b: 255 },
		legendary: { r: 255, g: 178, b: 68 },
	};

// The drop rules for one Zone (ADR 0024 §2/§8). `bases` is the base-type names this Zone
// can drop (a subset/reorder of BASES); `dropChance` is P(a kill drops anything);
// `rarities` optionally re-weights the tiers (defaults to RARITIES).
export interface LootTable {
	bases: string[];
	dropChance: number;
	rarities?: RarityDef[];
}

// The fallback table: full base list, every kill drops, default rarity weights — for a
// Zone with no authored table.
export const DEFAULT_LOOT_TABLE: LootTable = {
	bases: BASES.map((b) => b.name),
	dropChance: 1,
};

// Deeper Zones tilt the odds toward the higher tiers (still long-tailed) — a Field 3 or
// Dungeon drop is worth more than a Field 1 one without ever guaranteeing a jackpot.
const RICH_RARITIES: RarityDef[] = [
	{ name: 'common', weight: 40, affixes: 1 },
	{ name: 'uncommon', weight: 30, affixes: 2 },
	{ name: 'rare', weight: 18, affixes: 3 },
	{ name: 'epic', weight: 9, affixes: 4 },
	{ name: 'legendary', weight: 3, affixes: 5 },
];

// The shipped per-Zone Loot tables (ADR 0024 §2/§3): Fields drop occasionally (never
// pointless, just not efficient), the Dungeon is the reliable faucet (every kill, full
// pool, boosted odds). Fields deepen with distance: wider pools, richer tiers.
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

// Fail loudly at load if a table names a base that doesn't exist, so a typo can't silently
// collapse to the first base at roll time.
for (const [id, table] of Object.entries(LOOT_TABLES))
	for (const name of table.bases)
		if (!BASES.some((b) => b.name === name))
			throw new Error(`loot table '${id}' references unknown base '${name}'`);

/** The Loot table for a Zone id, falling back to the default table (ADR 0024 §2). */
export function lootTableFor(zoneId: string): LootTable {
	return LOOT_TABLES[zoneId] ?? DEFAULT_LOOT_TABLE;
}

/** The rarity + base label ("rare Iron Sword"), the one source both the Drop label and
 * the pickup log line read. */
export function itemLabel(item: Pick<Item, 'rarity' | 'base'>): string {
	return `${item.rarity} ${item.base}`;
}

/** Rolls a base + rarity + affixes from the table, threading RNG state. Returned item.id
 * is 0; callers assign a real id. */
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

/**
 * Roll a Zone's drop for one kill: gate on `dropChance`, then roll the item on a hit.
 * Threads RNG state on BOTH paths, so a no-drop still advances the seed and the next kill
 * can't repeat the roll. `item` is null when nothing dropped.
 */
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

// Resolve a base-type name to its entry, falling back to the first base for an unknown
// name so a malformed table can't crash a roll.
function baseByName(name: string): BaseType {
	return BASES.find((b) => b.name === name) ?? BASES[0];
}
