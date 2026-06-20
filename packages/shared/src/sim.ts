import type { Control, Entity, EntityKind, Input, WorldState } from "./types"
import { BOX, GROUND_TOP, MONSTER, PHYS, SPAWN, XP_PER_KILL } from "./constants"
import { isSolid, makeStarterField } from "./terrain"
import { stepEntity } from "./physics"
import { aabbOverlap, entityBox, meleeHitbox } from "./combat"
import { applyXp, maxHpForLevel } from "./progression"
import { rollItem } from "./loot"

export function spawnPlayer(id: number, x: number, y: number): Entity {
  return {
    id,
    kind: "player",
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

export function spawnMonster(kind: EntityKind, id: number, x: number, y: number): Entity {
  return {
    id,
    kind,
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

/** A fresh single-player Zone: starter Field, player at spawn, scattered chasers. */
export function createWorld(seed = 1): WorldState {
  const terrain = makeStarterField()
  const player = spawnPlayer(1, SPAWN.x, SPAWN.y)
  const monsters: Entity[] = []
  let id = 2
  for (let i = 0; i < 8; i++) {
    const x = 40 + i * 22
    monsters.push(spawnMonster("chaser", id++, x, GROUND_TOP - BOX.h))
  }
  return {
    tick: 0,
    terrain,
    player,
    progress: { level: 1, xp: 0, gold: 0 },
    monsters,
    inventory: [],
    log: ["Welcome. Hunt the chasers (j to attack)."],
    nextId: id,
    rngState: seed,
  }
}

// TODO(M1): shooter archetype + projectiles; monster respawn timers; multiple
// Zones + Town/NPC vendor. Chasers-only keeps the first slice honest and tested.

/** Advance the whole Zone one tick. Pure: shares static terrain, returns new
 * dynamic state. Deterministic given (world, input, dtMs). */
export function step(w: WorldState, input: Input, dtMs: number): WorldState {
  const dt = Math.min(dtMs / 1000, PHYS.maxDt)
  const t = w.terrain
  let rngState = w.rngState
  let nextId = w.nextId
  let progress = w.progress
  const inventory = w.inventory.slice()
  const log = w.log.slice(-5)

  // --- player movement ---
  const pCtl: Control = { moveX: input.moveX, jump: input.jump }
  let player = stepEntity(t, w.player, pCtl, dt).e
  player.attackT = Math.max(0, player.attackT - dt)
  player.hurtT = Math.max(0, player.hurtT - dt)

  // --- player attack (resolved against monsters below) ---
  const attacking = input.attack && player.attackT <= 0
  if (attacking) player = { ...player, attackT: 0.35 }
  const hb = attacking ? meleeHitbox(player) : null

  // --- monsters ---
  const monsters: Entity[] = []
  for (const m0 of w.monsters) {
    let m: Entity = { ...m0 }
    m.hurtT = Math.max(0, m.hurtT - dt)

    // AI: chase when the player is near, else patrol in the facing direction.
    const dx = player.x - m.x
    let moveX: -1 | 0 | 1
    if (m.kind === "chaser" && Math.abs(dx) < MONSTER.chaserAggro) moveX = dx > 0 ? 1 : -1
    else moveX = m.facing
    const res = stepEntity(t, m, { moveX, jump: false }, dt)
    m = res.e

    // patrol turn-around at walls and platform edges
    if (m.onGround) {
      const lead = moveX >= 0 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x)
      const footY = Math.ceil(m.y + BOX.h)
      if (res.hitWall || !isSolid(t, lead, footY)) m.facing = m.facing === 1 ? -1 : 1
    }

    // player melee → monster
    if (hb && m.hurtT <= 0 && aabbOverlap(hb, entityBox(m))) {
      m = { ...m, hp: m.hp - 8, hurtT: 0.6 }
    }
    // monster contact → player
    if (m.hp > 0 && player.hurtT <= 0 && aabbOverlap(entityBox(player), entityBox(m))) {
      player = { ...player, hp: player.hp - MONSTER.contactDamage, hurtT: 0.6 }
    }

    if (m.hp > 0) {
      monsters.push(m)
    } else {
      // death → XP (+ level up) and an instanced loot roll into inventory
      const ap = applyXp(progress, XP_PER_KILL)
      progress = ap.progress
      if (ap.leveled > 0) {
        const mhp = maxHpForLevel(progress.level)
        player = { ...player, maxHp: mhp, hp: mhp }
        log.push(`Level up! Now level ${progress.level}.`)
      }
      const roll = rollItem(rngState, progress.level)
      rngState = roll.state
      const item = { ...roll.item, id: nextId++ }
      inventory.push(item)
      log.push(`Looted ${item.rarity} ${item.base}.`)
    }
  }

  // forgiving death: respawn at spawn, full HP, brief invulnerability
  if (player.hp <= 0) {
    player = { ...player, hp: player.maxHp, x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, hurtT: 1 }
    log.push("You fell. Respawned in safety.")
  }

  return {
    tick: w.tick + 1,
    terrain: t,
    player,
    progress,
    monsters,
    inventory,
    log,
    nextId,
    rngState,
  }
}
