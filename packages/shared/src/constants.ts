// Tunable game constants. Implementation detail, not domain vocabulary — the
// glossary lives in /CONTEXT.md.

export const TICK_HZ = 60 // single-player client sim rate (server is 20Hz in M2)

export const WORLD = { w: 240, h: 40 } as const
export const GROUND_TOP = WORLD.h - 3

// logical collision box (decoupled from the ~7x5 visual sprite — ADR 0003)
export const BOX = { w: 5, h: 5 } as const

// physics, in cells/second
export const PHYS = {
  speed: 22, // player horizontal speed
  jump: 34, // jump impulse
  grav: 90, // gravity
  maxDt: 0.05, // clamp to avoid tunnelling on long frames
} as const

// combat — melee is a forgiving frontal arc (ADR / CONTEXT: Combat)
export const COMBAT = {
  meleeReach: 6, // how far in front the arc extends (cells)
  meleeDamage: 8,
  attackCooldown: 0.35, // seconds between swings
  iframes: 0.6, // invulnerability window after taking a hit
} as const

export const MONSTER = {
  chaserHp: 24,
  chaserSpeed: 12,
  chaserAggro: 22, // horizontal distance at which a chaser starts chasing
  contactDamage: 6,
} as const

export const PROGRESSION = { levelCap: 30 } as const

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const

export const XP_PER_KILL = 12
