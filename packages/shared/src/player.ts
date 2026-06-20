// player.ts — the client Player's own state: their Avatar, progression,
// inventory, and which Zone they occupy. Per-client in M2 — the server owns the
// consequences (XP/Gold/inventory), the client owns Avatar position (ADR 0001).
import type { Entity, Item, PlayerProgress } from "./types"
import type { ZoneId } from "./world"
import { PHYS } from "./constants"
import { maxHpForLevel } from "./progression"

export interface PlayerState {
  avatar: Entity // the in-world character (CONTEXT: Avatar)
  progress: PlayerProgress
  inventory: Item[]
  zoneId: ZoneId // which Zone the Avatar currently occupies
  log: string[] // recent events (level ups, loot) for the HUD
  nextId: number // ids for looted Items
  rngState: number // instanced-loot RNG (CONTEXT: Instanced loot)
}

/** The Avatar entity (id 1) at a position, with level-1 stats. */
export function spawnAvatar(x: number, y: number): Entity {
  return {
    id: 1,
    type: "player",
    x,
    y,
    vx: 0,
    vy: 0,
    speed: PHYS.speed,
    facing: 1,
    onGround: false,
    hp: maxHpForLevel(1),
    maxHp: maxHpForLevel(1),
    hurtT: 0,
    attackT: 0,
  }
}

/** A fresh Player placed at (x, y) in the given Zone. */
export function spawnPlayerState(zoneId: ZoneId, x: number, y: number, seed = 1): PlayerState {
  return {
    avatar: spawnAvatar(x, y),
    progress: { level: 1, xp: 0, gold: 0 },
    inventory: [],
    zoneId,
    log: ["Welcome. Hunt the chasers (j to attack)."],
    nextId: 1,
    rngState: seed,
  }
}
