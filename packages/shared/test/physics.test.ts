import { test, expect } from "bun:test"
import { parseTerrain, stepEntity, spawnAvatar, BOX } from "../src"
import type { Control, Entity, Terrain } from "../src"

const FLAT = parseTerrain([
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "############",
  "############",
])
const COL = "........#..." // solid column at x=8
const WALL = parseTerrain([
  COL, COL, COL, COL, COL, COL, COL, COL, COL, COL,
  "############",
  "############",
])
const IDLE: Control = { moveX: 0, jump: false }

function settle(t: Terrain, e: Entity, ctl: Control = IDLE, n = 240): Entity {
  for (let i = 0; i < n; i++) e = stepEntity(t, e, ctl, 1 / 60).e
  return e
}

test("gravity: an entity falls and lands on the ground", () => {
  const e = settle(FLAT, spawnAvatar(2, 0))
  expect(e.onGround).toBe(true)
  expect(e.vy).toBe(0)
})

test("walls: horizontal movement is blocked by a solid column", () => {
  const e = settle(WALL, spawnAvatar(1, 0), { moveX: 1, jump: false })
  expect(e.x + BOX.w).toBeLessThanOrEqual(8) // never overlaps the wall at x=8
  expect(e.x).toBeGreaterThan(1) // but it did move toward it
})

test("jump: leaves the ground with upward velocity", () => {
  const grounded = settle(FLAT, spawnAvatar(2, 0))
  expect(grounded.onGround).toBe(true)
  const jumped = stepEntity(FLAT, grounded, { moveX: 0, jump: true }, 1 / 60).e
  expect(jumped.vy).toBeLessThan(0)
  expect(jumped.onGround).toBe(false)
})
