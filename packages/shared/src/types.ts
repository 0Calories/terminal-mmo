// Core data shapes for the simulation. Domain meanings live in /CONTEXT.md.

export type Facing = 1 | -1

/** Solid geometry of a Zone. Avatars collide with this and nothing else. */
export interface Terrain {
  w: number
  h: number
  cells: Uint8Array // 1 = solid, 0 = empty; row-major (y * w + x)
}

/** Movement intent for one entity for one tick. */
export interface Control {
  moveX: -1 | 0 | 1
  jump: boolean
}

/** A Player's intent for one tick (movement + attack). */
export interface Input extends Control {
  attack: boolean
}

export type EntityKind = "player" | "chaser" | "shooter"

export interface Entity {
  id: number
  kind: EntityKind
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  facing: Facing
  onGround: boolean
  hp: number
  maxHp: number
  hurtT: number // remaining invulnerability (seconds)
  attackT: number // remaining attack cooldown (seconds)
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary"
export type Slot = "weapon" | "armor" | "accessory"

export interface ItemAffix {
  stat: string
  value: number
}

/** Item = base type + rarity tier + randomized affixes (CONTEXT: Item). */
export interface Item {
  id: number
  base: string
  slot: Slot
  rarity: Rarity
  affixes: ItemAffix[]
}

export interface PlayerProgress {
  level: number
  xp: number
  gold: number
}

/** Full single-player Zone state. (M2 splits authoritative server state out.) */
export interface WorldState {
  tick: number
  terrain: Terrain
  player: Entity
  progress: PlayerProgress
  monsters: Entity[]
  inventory: Item[]
  log: string[] // recent events (level ups, loot) for the HUD
  nextId: number
  rngState: number // threaded deterministic RNG (CONTEXT: Instanced loot)
}
