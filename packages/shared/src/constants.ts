// Tunable game constants. Implementation detail, not domain vocabulary — the
// glossary lives in /CONTEXT.md.

export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

// logical collision box (decoupled from the ~7x5 visual sprite — ADR 0003)
export const BOX = { w: 5, h: 5 } as const;

// physics, in cells/second
export const PHYS = {
	speed: 22, // player horizontal speed
	jump: 34, // jump impulse
	grav: 90, // gravity
	maxDt: 0.05, // clamp to avoid tunnelling on long frames
} as const;

// combat — melee is a forgiving frontal arc (ADR / CONTEXT: Combat)
export const COMBAT = {
	meleeReach: 6, // how far in front the arc extends (cells)
	meleeDamage: 8,
	attackCooldown: 0.35, // seconds between swings
	iframes: 0.6, // invulnerability window after taking a hit
} as const;

export const MONSTER = {
	chaserHp: 24,
	chaserSpeed: 12,
	chaserAggro: 22, // horizontal distance at which a chaser starts chasing
	contactDamage: 6,
} as const;

// shooter — a ranged Monster that keeps its distance and fires Projectiles
// (CONTEXT: Combat — ranged is precise; positioning matters). Distances in
// cells, speeds in cells/second, times in seconds.
export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46, // horizontal distance at which it engages + fires
	keepDist: 20, // retreats if the Avatar comes closer than this
	fireCooldown: 1.4, // between shots
	projSpeed: 36, // Projectile horizontal speed
	projLife: 2.4, // before a Projectile expires
	projDamage: 7,
} as const;

// logical Projectile size (small, decoupled from its glyph — ADR 0003)
export const PROJECTILE = { w: 1, h: 1 } as const;

export const PROGRESSION = { levelCap: 30 } as const;

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const;

// Town — a small, walkable plaza (the safe social hub). Narrower than the Field
// and free of scattered platforms, so it reads as a distinct, tidy interior.
export const TOWN = { w: 80 } as const;

// Monster respawn — a dead Field Monster reappears at its spawn point after this
// delay (seconds, counted down by dt so it's deterministic — story 20).
export const RESPAWN = { delaySec: 5 } as const;

export const XP_PER_KILL = 12;
