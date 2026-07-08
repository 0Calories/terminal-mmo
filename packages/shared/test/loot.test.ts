import { expect, test } from 'bun:test';
import type { Rarity } from '../src';
import {
	BASES,
	DEFAULT_LOOT_TABLE,
	itemLabel,
	LOOT_TABLES,
	lootTableFor,
	RARITIES,
	RARITY_COLOR,
	rollDrop,
	rollItem,
} from '../src';

test('rollItem is deterministic for a given state', () => {
	const a = rollItem(123, 5);
	const b = rollItem(123, 5);
	expect(b.item).toEqual(a.item);
	expect(b.state).toBe(a.state);
});

test('rolled item is structurally valid; affix count matches rarity', () => {
	const { item } = rollItem(999, 10);
	const rar = RARITIES.find((r) => r.name === item.rarity);
	expect(rar).toBeDefined();
	if (!rar) throw new Error(`unknown rarity: ${item.rarity}`);
	expect(item.affixes.length).toBe(rar.affixes);

	const base = BASES.find((b) => b.name === item.base);
	expect(base).toBeDefined();
	if (!base) throw new Error(`unknown base: ${item.base}`);
	expect(item.slot).toBe(base.slot);
});

test('rolling many items produces variety', () => {
	let state = 1;
	const bases = new Set<string>();
	for (let i = 0; i < 60; i++) {
		const r = rollItem(state, 5);
		state = r.state;
		bases.add(r.item.base);
	}
	expect(bases.size).toBeGreaterThan(1);
});

// --- Rarity colour: the single visual source (#238) --------------------------

test('every rarity tier maps to a distinct colour (in-world + on-pickup source)', () => {
	const tiers: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
	// Each channel is a valid 0–255 byte so both the shared renderer and the client theme
	// can consume it directly.
	for (const t of tiers) {
		const c = RARITY_COLOR[t];
		expect(c).toBeDefined();
		for (const ch of [c.r, c.g, c.b]) {
			expect(ch).toBeGreaterThanOrEqual(0);
			expect(ch).toBeLessThanOrEqual(255);
		}
	}
	// The tiers are visually distinct — no two share a colour, so rarity always reads.
	const keys = tiers.map((t) => {
		const c = RARITY_COLOR[t];
		return `${c.r},${c.g},${c.b}`;
	});
	expect(new Set(keys).size).toBe(tiers.length);
});

test('itemLabel is the one rarity+base wording (shared by in-world label + pickup log)', () => {
	const { item } = rollItem(7, 5);
	expect(itemLabel(item)).toBe(`${item.rarity} ${item.base}`);
});

// --- Per-Field/Dungeon loot tables (#238, ADR 0024 §2/§3) --------------------

test('lootTableFor resolves each shipped Zone and falls back to the default', () => {
	for (const id of Object.keys(LOOT_TABLES))
		expect(lootTableFor(id)).toBe(LOOT_TABLES[id]);
	// An unknown Zone id gets the full-pool, always-drop default.
	expect(lootTableFor('no-such-zone')).toBe(DEFAULT_LOOT_TABLE);
});

test('a Zone table only ever rolls its own base pool', () => {
	// The table biases WHAT drops: no roll off field-01's warm-up pool can produce a base
	// outside it.
	const table = lootTableFor('field-01');
	let state = 5;
	for (let i = 0; i < 200; i++) {
		const r = rollItem(state, 8, table);
		state = r.state;
		expect(table.bases).toContain(r.item.base);
	}
});

test('the Dungeon faucet drops on every kill; a Field drops only sometimes', () => {
	// dropChance is the "when" lever (ADR 0024 §2): the Dungeon is reliable (1.0), a Field
	// occasional (< 1).
	const dungeon = lootTableFor('dungeon-01');
	const field = lootTableFor('field-01');
	expect(dungeon.dropChance).toBe(1);
	expect(field.dropChance).toBeLessThan(1);

	let ds = 1;
	let fs = 1;
	let dungeonDrops = 0;
	let fieldDrops = 0;
	const N = 400;
	for (let i = 0; i < N; i++) {
		const d = rollDrop(ds, 5, dungeon);
		ds = d.state;
		if (d.item) dungeonDrops++;
		const f = rollDrop(fs, 5, field);
		fs = f.state;
		if (f.item) fieldDrops++;
	}
	expect(dungeonDrops).toBe(N);
	expect(fieldDrops).toBeGreaterThan(0);
	expect(fieldDrops).toBeLessThan(N);
});

test('rollDrop is deterministic and threads state on BOTH the drop and no-drop paths', () => {
	const table = lootTableFor('field-01');
	const a = rollDrop(42, 5, table);
	const b = rollDrop(42, 5, table);
	expect(a.item).toEqual(b.item);
	expect(a.state).toBe(b.state);
	// A no-drop still advances the seed, so a subsequent kill can't repeat the roll.
	let state = 7;
	let sawNoDrop = false;
	for (let i = 0; i < 50 && !sawNoDrop; i++) {
		const r = rollDrop(state, 5, table);
		if (!r.item) {
			sawNoDrop = true;
			expect(r.state).not.toBe(state);
		}
		state = r.state;
	}
	expect(sawNoDrop).toBe(true);
});

test('a deeper Zone tilts toward higher rarity tiers than a starter Field', () => {
	// The "deeper = better" tilt: field-03/dungeon carry richer rarity weights, so over
	// many rolls they produce more above-common loot than field-01.
	function aboveCommon(tableId: string, seed: number): number {
		const table = lootTableFor(tableId);
		let state = seed;
		let count = 0;
		for (let i = 0; i < 600; i++) {
			const r = rollItem(state, 5, table);
			state = r.state;
			if (r.item.rarity !== 'common') count++;
		}
		return count;
	}
	expect(aboveCommon('field-03', 3)).toBeGreaterThan(
		aboveCommon('field-01', 3),
	);
});
