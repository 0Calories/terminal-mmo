export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

// logical collision box, decoupled from the ~7x5 visual sprite (ADR 0003)
export const BOX = { w: 5, h: 5 } as const;

// cells/second
export const PHYS = {
	speed: 22,
	jump: 34,
	grav: 90,
	maxDt: 0.05, // clamp to avoid tunnelling on long frames
} as const;

export const COMBAT = {
	meleeReach: 6,
	meleeDamage: 8,
	attackCooldown: 0.35,
	iframes: 0.6,
} as const;

export const MONSTER = {
	chaserHp: 24,
	chaserSpeed: 12,
	chaserAggro: 22,
	// Hold position once this close instead of homing on the exact Avatar x:
	// otherwise dx flips sign each frame, flipping facing — visible jitter.
	chaserDeadzone: 2,
	contactDamage: 6,
} as const;

export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46,
	keepDist: 20, // retreats if the Avatar comes closer than this
	fireCooldown: 1.4,
	projSpeed: 36,
	projLife: 2.4,
	projDamage: 7,
} as const;

export const PROJECTILE = { w: 1, h: 1 } as const;

export const PROGRESSION = { levelCap: 30 } as const;

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const;

export const TOWN = { w: 80 } as const;

export const RESPAWN = { delaySec: 5 } as const;

export const XP_PER_KILL = 12;
