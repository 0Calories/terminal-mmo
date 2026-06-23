import { expect, test } from 'bun:test';
import { BASES, RARITIES, rollItem } from '../src';

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
