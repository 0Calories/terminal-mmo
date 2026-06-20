// world.ts — the shared World of Zones. A Zone is the unit of place + simulation
// (CONTEXT: Zone); the World is every Zone, advanced by a shared tick. This is
// server-authoritative in M2; here it also drives the single-player loop.

import { BOX, GROUND_TOP, MONSTER } from "./constants"
import { makeStarterField } from "./terrain"
import type { Entity, EntityType, Terrain } from "./types"

export type ZoneId = string
export type ZoneType = "field" | "town"

/** A discrete, bounded area of the World: solid Terrain + the Monsters in it.
 * Two kinds (CONTEXT: Zone) — combat Fields and safe Towns. */
export interface Zone {
  id: ZoneId
  type: ZoneType
  terrain: Terrain
  monsters: Entity[]
}

/** The whole World: every Zone keyed by id, plus a shared sim tick. */
export interface World {
  zones: Record<ZoneId, Zone>
  tick: number
}

/** The Zone a given id refers to. */
export function activeZone(world: World, zoneId: ZoneId): Zone {
  return world.zones[zoneId]
}

export function spawnMonster(type: EntityType, id: number, x: number, y: number): Entity {
  return {
    id,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    speed: MONSTER.chaserSpeed,
    facing: 1,
    onGround: false,
    hp: MONSTER.chaserHp,
    maxHp: MONSTER.chaserHp,
    hurtT: 0,
    attackT: 0,
  }
}

/** A combat Field: full-width ground + platforms, with scattered chasers. */
export function makeFieldZone(id: ZoneId, seed = 1337): Zone {
  const terrain = makeStarterField(seed)
  const monsters: Entity[] = []
  let mid = 2 // the Avatar is id 1
  for (let i = 0; i < 8; i++) {
    const x = 40 + i * 22
    monsters.push(spawnMonster("chaser", mid++, x, GROUND_TOP - BOX.h))
  }
  return { id, type: "field", terrain, monsters }
}
