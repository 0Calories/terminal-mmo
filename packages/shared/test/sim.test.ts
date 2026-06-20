import { test, expect } from "bun:test"
import {
  createGame, step, spawnAvatar, spawnMonster, makeStarterField, activeZone,
  BOX, GROUND_TOP, XP_PER_KILL, MONSTER,
} from "../src"
import type { GameState, Input, PlayerState, Zone } from "../src"

const IDLE: Input = { moveX: 0, jump: false, attack: false }

test("createGame separates Player state from the World of Zones", () => {
  const g = createGame()
  expect(g.world.tick).toBe(0)
  expect(g.player.avatar.type).toBe("player")
  expect(g.player.zoneId in g.world.zones).toBe(true)
  const zone = activeZone(g.world, g.player.zoneId)
  expect(zone.type).toBe("field")
  expect(zone.monsters.length).toBe(8)
})

test("step advances the World tick", () => {
  expect(step(createGame(), IDLE, 16).world.tick).toBe(1)
})

test("step is deterministic for identical seed + inputs", () => {
  let a = createGame(7)
  let b = createGame(7)
  const seq: Input = { moveX: 1, jump: false, attack: true }
  for (let i = 0; i < 40; i++) {
    a = step(a, seq, 16)
    b = step(b, seq, 16)
  }
  expect(b.player.avatar.x).toBe(a.player.avatar.x)
  expect(b.player.inventory.length).toBe(a.player.inventory.length)
  expect(b.player.progress.xp).toBe(a.player.progress.xp)
  expect(activeZone(b.world, b.player.zoneId).monsters.length).toBe(
    activeZone(a.world, a.player.zoneId).monsters.length,
  )
})

// player at x, one chaser directly in front on flat ground, in one Field Zone
function adjacentGame(monsterHp?: number): GameState {
  const y = GROUND_TOP - BOX.h
  const m = spawnMonster("chaser", 2, 20 + BOX.w, y)
  if (monsterHp !== undefined) {
    m.hp = monsterHp
    m.maxHp = monsterHp
  }
  const zone: Zone = { id: "field-01", type: "field", terrain: makeStarterField(), monsters: [m] }
  const player: PlayerState = {
    avatar: spawnAvatar(20, y),
    progress: { level: 1, xp: 0, gold: 0 },
    inventory: [],
    zoneId: zone.id,
    log: [],
    nextId: 1,
    rngState: 1,
  }
  return { player, world: { zones: { [zone.id]: zone }, tick: 0 } }
}

test("attacking damages an adjacent monster", () => {
  const g = step(adjacentGame(), { moveX: 0, jump: false, attack: true }, 16)
  const zone = activeZone(g.world, g.player.zoneId)
  expect(zone.monsters[0].hp).toBe(MONSTER.chaserHp - 8)
})

test("killing a monster grants XP and an instanced loot drop", () => {
  const g = step(adjacentGame(4), { moveX: 0, jump: false, attack: true }, 16)
  expect(activeZone(g.world, g.player.zoneId).monsters.length).toBe(0)
  expect(g.player.inventory.length).toBe(1)
  expect(g.player.progress.xp).toBe(XP_PER_KILL)
  expect(g.player.inventory[0].id).toBe(1) // assigned from the Player's nextId
})

test("only the active Zone ticks; the Avatar's persistent state lives above it", () => {
  // a second, dormant Field the Player is not in
  const dormant: Zone = { id: "field-02", type: "field", terrain: makeStarterField(), monsters: [
    spawnMonster("chaser", 99, 60, GROUND_TOP - BOX.h),
  ] }
  let g = createGame()
  g = { player: g.player, world: { zones: { ...g.world.zones, [dormant.id]: dormant }, tick: g.world.tick } }
  const before = g.world.zones["field-02"]
  g = step(g, { moveX: 1, jump: false, attack: false }, 16)
  // dormant Zone untouched (same reference), active Zone advanced
  expect(g.world.zones["field-02"]).toBe(before)
  expect(g.player.zoneId).toBe("field-01")
})
