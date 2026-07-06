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

// Rarity → colour is the CORE visual language of loot (CONTEXT.md, Item): the ONE
// shared source both the in-world Drop glyph and the on-pickup readout paint from, so a
// tier reads identically wherever an Item is shown and the client can never drift from
// the sim. RGB (0–255) so it feeds both the shared renderer and the client theme. The
// ladder climbs cool→hot: grey → green → blue → purple → gold, the genre-standard rarity
// gradient a developer reads at a glance.
export const RARITY_COLOR: Record<Rarity, { r: number; g: number; b: number }> =
	{
		common: { r: 176, g: 184, b: 196 },
		uncommon: { r: 96, g: 210, b: 122 },
		rare: { r: 92, g: 158, b: 255 },
		epic: { r: 190, g: 120, b: 255 },
		legendary: { r: 255, g: 178, b: 68 },
	};

// A per-Field/Dungeon Loot table (ADR 0024 §2/§8): the drop rules for ONE Zone, so a
// warm-up Field and the reliable Dungeon faucet pull from different pools at different
// rates. `bases` is the set of base-type names this Zone can drop (a subset/reorder of
// BASES, so its loot reads themed); `dropChance` is P(a kill drops anything) — the
// "when" lever that makes the Dungeon a reliable faucet and Fields an occasional bonus;
// `rarities` optionally re-weights the tiers for a deeper Zone (defaults to RARITIES).
export interface LootTable {
	bases: string[];
	dropChance: number;
	rarities?: RarityDef[];
}

// The fallback table: the full base list, every kill drops, default rarity weights — so
// a Zone with no authored table (and the bare `rollItem(state, level)` call) behaves
// exactly as loot did before per-Zone tables existed.
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

// The shipped World's per-Zone Loot tables, keyed by Zone id (ADR 0024 §2/§3): the
// exploration-spine Fields drop OCCASIONALLY (fighting out there is never pointless, just
// not the efficient path), while the instanced Dungeon is the RELIABLE faucet — every
// kill drops, from the full pool, at the boosted odds. Fields deepen with distance from
// the hub: wider pools and richer tiers the further you venture.
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

// Fail loudly at load if an authored table names a base that doesn't exist (a typo in
// LOOT_TABLES), so a mis-keyed pool can never silently collapse to the first base at roll
// time — turns a quiet content bug into a startup error.
for (const [id, table] of Object.entries(LOOT_TABLES))
	for (const name of table.bases)
		if (!BASES.some((b) => b.name === name))
			throw new Error(`loot table '${id}' references unknown base '${name}'`);

/** The Loot table for a Zone id, falling back to the default table (ADR 0024 §2). */
export function lootTableFor(zoneId: string): LootTable {
	return LOOT_TABLES[zoneId] ?? DEFAULT_LOOT_TABLE;
}

/** The rarity + base label for an Item ("rare Iron Sword"), the ONE source both the
 * in-world Drop label and the on-pickup log line read, so they can never word it apart. */
export function itemLabel(item: Pick<Item, 'rarity' | 'base'>): string {
	return `${item.rarity} ${item.base}`;
}

/** Threads RNG state. Returned item.id is 0; callers assign a real id. Rolls a base +
 * rarity + affixes from the given Loot table (defaulting to the full pool), so a Zone's
 * table biases WHAT drops without changing the seeded, deterministic roll structure. */
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
 * Roll a Zone's drop for one kill: FIRST gate on the table's `dropChance` (the reworked
 * "when" — not every kill drops), then, on a hit, roll the item. Threads RNG state on
 * BOTH paths, so a no-drop still advances a contributor's seed deterministically and the
 * next kill can't repeat the same roll. `item` is null when nothing dropped.
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

// Resolve a base-type name to its full entry, falling back to the first base for an
// unknown name so a malformed table can never crash a roll.
function baseByName(name: string): BaseType {
	return BASES.find((b) => b.name === name) ?? BASES[0];
}
