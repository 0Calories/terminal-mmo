import { test, expect } from "bun:test"
import {
  createWorld, step, spawnPlayer, spawnMonster, makeStarterField,
  BOX, GROUND_TOP, XP_PER_KILL, MONSTER,
} from "../src"
import type { Input, WorldState } from "../src"

const IDLE: Input = { moveX: 0, jump: false, attack: false }

test("createWorld produces a player and chasers at tick 0", () => {
  const w = createWorld()
  expect(w.tick).toBe(0)
  expect(w.player.kind).toBe("player")
  expect(w.monsters.length).toBe(8)
})

test("step advances the tick", () => {
  expect(step(createWorld(), IDLE, 16).tick).toBe(1)
})

test("step is deterministic for identical seed + inputs", () => {
  let a = createWorld(7)
  let b = createWorld(7)
  const seq: Input = { moveX: 1, jump: false, attack: true }
  for (let i = 0; i < 40; i++) {
    a = step(a, seq, 16)
    b = step(b, seq, 16)
  }
  expect(b.player.x).toBe(a.player.x)
  expect(b.inventory.length).toBe(a.inventory.length)
  expect(b.progress.xp).toBe(a.progress.xp)
})

// player at x, one chaser directly in front on flat ground
function adjacentWorld(monsterHp?: number): WorldState {
  const terrain = makeStarterField()
  const y = GROUND_TOP - BOX.h
  const m = spawnMonster("chaser", 2, 20 + BOX.w, y)
  if (monsterHp !== undefined) {
    m.hp = monsterHp
    m.maxHp = monsterHp
  }
  return {
    tick: 0, terrain, player: spawnPlayer(1, 20, y),
    progress: { level: 1, xp: 0, gold: 0 }, monsters: [m],
    inventory: [], log: [], nextId: 3, rngState: 1,
  }
}

test("attacking damages an adjacent monster", () => {
  const w = step(adjacentWorld(), { moveX: 0, jump: false, attack: true }, 16)
  expect(w.monsters[0].hp).toBe(MONSTER.chaserHp - 8)
})

test("killing a monster grants XP and an instanced loot drop", () => {
  const w = step(adjacentWorld(4), { moveX: 0, jump: false, attack: true }, 16)
  expect(w.monsters.length).toBe(0)
  expect(w.inventory.length).toBe(1)
  expect(w.progress.xp).toBe(XP_PER_KILL)
  expect(w.inventory[0].id).toBe(3) // assigned from nextId
})
