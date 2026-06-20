import { test, expect } from "bun:test"
import { rollItem, RARITIES, BASES } from "../src"

test("rollItem is deterministic for a given state", () => {
  const a = rollItem(123, 5)
  const b = rollItem(123, 5)
  expect(b.item).toEqual(a.item)
  expect(b.state).toBe(a.state)
})

test("rolled item is structurally valid; affix count matches rarity", () => {
  const { item } = rollItem(999, 10)
  const rar = RARITIES.find((r) => r.name === item.rarity)
  expect(rar).toBeDefined()
  expect(item.affixes.length).toBe(rar!.affixes)
  expect(BASES.some((b) => b.name === item.base)).toBe(true)
  expect(item.slot).toBe(BASES.find((b) => b.name === item.base)!.slot)
})

test("rolling many items produces variety", () => {
  let state = 1
  const bases = new Set<string>()
  for (let i = 0; i < 60; i++) {
    const r = rollItem(state, 5)
    state = r.state
    bases.add(r.item.base)
  }
  expect(bases.size).toBeGreaterThan(1)
})
