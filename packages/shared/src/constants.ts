export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

// logical collision box, decoupled from the ~7x5 visual sprite (ADR 0003)
export const BOX = { w: 5, h: 5 } as const;

// Entity collision-box footprints, engine-derived from the anchor glyph (ADR 0008).
// One source of truth shared by parseZone (which builds these boxes) and the Zone
// editor's placement ghost (#96), so the preview can never drift from validation.
export const NPC_BOX = { w: 4, h: BOX.h } as const; // matches the factory Merchant
export const PORTAL_BOX = { w: 4, h: 7 } as const; // mirrors world.ts's fixed dims

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
	// The basic swing's three phases (ADR 0017 §1), authored in seconds (resolveCombat
	// decays in seconds). The hitbox is live ONLY during `active` — never on the
	// wind-up start tick or in recovery — which is the whole point of the phase model.
	// The total (~0.38s) is close to the retired instant `attackCooldown` (0.35), so a
	// swing's cadence is roughly unchanged while gaining a telegraph + a committed
	// recovery. Durations are chunky enough to survive 30 Hz input quantization
	// (ADR 0017 §11).
	swing: { windup: 0.1, active: 0.12, recovery: 0.16 },
	iframes: 0.6,
	// Intensity of a death blood burst (ADR 0013). High enough to saturate the
	// client speck count so a kill reads visibly bigger and wider than a chip hit;
	// paired with a radial dir 0 it sprays in every direction.
	deathBurstIntensity: 30,
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

// Inferred-dimension cap for a parsed `.zone` grid (ADR 0008) — guards typos /
// runaway files. Generous vs the shipped 240×40 Field.
export const ZONE_MAX = { w: 2000, h: 200 } as const;

// Where a forgiving death drops the Avatar back into Town (story 23) — the Town
// entrance, matching the Field->Town portal's arrival point.
export const TOWN_SPAWN = { x: 12, y: GROUND_TOP - BOX.h } as const;

export const RESPAWN = { delaySec: 5 } as const;

// Automatic channeling (ADR 0001): the server fills one Channel of a Zone up to
// this soft population cap, then opens a fresh parallel Channel for further
// entrants. The Player never picks a Channel. Drain/consolidation is post-MVP.
export const CHANNEL = { softCap: 50 } as const;

export const XP_PER_KILL = 12;

// Max length of a Chat line, shared by the input cap, the server relay clamp, the
// chat log, and the over-head Speech bubble (#59, ADR 0007). Kept low enough that a
// full-length message wraps to a bubble that fits on screen.
export const CHAT_MAX_LEN = 120;
