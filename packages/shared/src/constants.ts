import type { EntityType } from './types';

export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

// logical collision box, decoupled from the ~7x5 visual sprite (ADR 0003)
export const BOX = { w: 5, h: 5 } as const;

// Entity collision-box footprints, engine-derived from the anchor glyph — shared by
// parseZone and the Zone editor's placement ghost so the preview can't drift (#96, ADR 0008).
export const NPC_BOX = { w: 4, h: BOX.h } as const; // matches the factory Merchant
export const PORTAL_BOX = { w: 4, h: 7 } as const; // mirrors world.ts's fixed dims

// cells/second
export const PHYS = {
	speed: 22,
	jump: 34,
	grav: 90,
	maxDt: 0.05, // clamp to avoid tunnelling on long frames
	// Exponential decay rate (per second) on the knockback-impulse channel only — input-
	// driven horizontal velocity is unaffected. Tuned so a shove dies in a few hundred ms (ADR 0017).
	drag: 8,
	// Impulse velocity below this snaps to 0, so a body doesn't creep on a tiny residual.
	impulseEpsilon: 0.01,
} as const;

// 1 is neutral: an impulse divided by mass 1 is itself (ADR 0017).
export const DEFAULT_MASS = 1;

export const COMBAT = {
	meleeReach: 6,
	meleeDamage: 8,
	// The basic swing's three phases in seconds (ADR 0017 §1). The hitbox is live ONLY
	// during `active`, never in wind-up or recovery. Durations are chunky enough to
	// survive 30 Hz input quantization (ADR 0017 §11).
	swing: { windup: 0.1, active: 0.12, recovery: 0.16 },
	iframes: 0.6,
	// The Dodge (ADR 0017 §5): a short hop granting i-frames for `active`, exposed through
	// `recovery`. The active window is shorter than recovery so a mistimed Dodge is
	// punishable. `cooldown` is the extra lockout after recovery — the spam-gate, anchored
	// at dodge start as a single `dodgeCdT` of (active + recovery + cooldown) = 1.2s.
	dodge: { active: 0.18, recovery: 0.22, impulse: 90, up: 10, cooldown: 0.8 },
	// The hit-reaction payload a landed basic swing carries (ADR 0017 §2): `meleeDamage` HP,
	// `poiseDamage` off Poise, and — only on a break — Stagger + Knockback.
	poiseDamage: 8,
	hitstun: 0.35, // seconds the victim's control is locked on Stagger (body still flies)
	knockback: 40, // horizontal Knockback impulse on a break (÷ Mass in applyImpulse)
	knockbackUp: 14, // a small upward pop on a break, so a Stagger lifts as well as shoves
	// Per-entity Poise (ADR 0017 §3): a pool that depletes by poiseDamage per hit and
	// regenerates only under no pressure; a hit to 0 Staggers (and refills). Tuned so the
	// break is observable before the kill: a chaser (24 HP) dies in 3 hits but breaks on
	// the 2nd. `regenDelay` gates regen so a flurry accumulates and reliably breaks while
	// spaced pokes recover — an always-on regen refilled between swings and the break never came.
	poise: { max: 16, regen: 12, regenDelay: 0.6 } as const,
	// Guard (ADR 0017 §5, ADR 0024): one held input. Any raised Guard is a Block — a
	// frontal brace that chips HP and drains Poise toward a guard-break (Parry removed).
	guard: {
		// A Block reduces a frontal hit to this fraction of its HP damage (chip)…
		blockChip: 0.25,
		// …and drains this much Poise per blocked hit. Tuned so a committer breaks a turtling
		// Player's pool (max 16) after a few blocks — no separate guard meter (ADR 0017 §5).
		blockPoise: 6,
		// `guardT` counts up while held but no longer gates anything; clamped here so an
		// indefinite hold doesn't grow the scalar unbounded.
		heldClamp: 1,
	} as const,
	// High enough to saturate the client speck count so a kill reads bigger than a chip
	// hit; paired with radial dir 0 it sprays every direction (ADR 0013).
	deathBurstIntensity: 30,
} as const;

export const MONSTER = {
	chaserHp: 24,
	chaserSpeed: 12,
	chaserAggro: 22,
	// Hold position once this close instead of homing on the exact Avatar x:
	// otherwise dx flips sign each frame, flipping facing — visible jitter.
	chaserDeadzone: 2,
	// A melee committer with no passive contact damage (ADR 0017 §9). `meleeRange` sits
	// just inside the hitbox reach so the active strike connects on a target holding its
	// ground, while the wind-up gives a reading Player room to step out and punish recovery.
	meleeDamage: 8,
	meleeRange: 4,
} as const;

// A heavy melee committer, the chaser's opposite (ADR 0017 §9, ADR 0024 §8): it lumbers,
// is hard to Stagger (big Poise pool + heavy Mass), hits far harder, and attacks
// deliberately (a long cool-down between commits) — a bruiser you bait and punish.
export const BRUTE = {
	hp: 60, // a poise-tank sponge — far more hits than the chaser's 24
	speed: 6, // half the chaser's 12: it lumbers rather than chases
	aggro: 26, // notices you a touch further out than the chaser
	// Hold inside this dx so facing doesn't flip-flop (mirrors chaserDeadzone).
	deadzone: 2,
	// Heavy Mass: a Knockback that rockets a chaser barely nudges the brute (÷ impulse).
	mass: 4,
	// 3× the shared default (16): where a chaser breaks on the Player's 2nd hit, the brute
	// shrugs off a whole flurry before Staggering (ADR 0017 §3).
	poiseMax: 48,
	// Hard-hitting: more than double the chaser's 8 HP damage…
	meleeDamage: 18,
	// …and a Poise bite that breaks a full Player pool (16) in one connect, so a landed
	// brute hit Staggers.
	meleePoise: 16,
	// Longer than the chaser (4), still inside meleeReach (6) so the strike connects while
	// the long telegraph lets a reading Player step out and punish recovery.
	meleeRange: 5,
	// Seconds between commits (shared `attackCdT` cadence). Generous vs the ~0.38s swing so
	// a long, punishable opening sits between heavy swings — deliberate, never flurrying.
	commitCooldown: 1.6,
} as const;

export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46,
	keepDist: 20, // retreats if the Avatar comes closer than this
	// Seconds between telegraphed shots (ADR 0017 §8): the shooter commits the shared swing
	// and fires one shot on the active frame, never auto-firing. Generous vs the ~0.38s swing
	// so a reading Player can react, dodge/block/swat, or close in to punish recovery.
	fireCooldown: 1.4,
	// cells/s: deliberately reactable, not hitscan — a Player can respond after the telegraph (ADR 0017 §8).
	projSpeed: 30,
	projLife: 2.4,
	// The pebble's hit-reaction payload: light HP + a small Poise bite that only Staggers
	// under sustained fire — same payload shape as a melee hit, one resolution path (ADR 0017 §8).
	projDamage: 7,
	projPoise: 6,
	projKnockback: 30,
	projKnockbackUp: 10,
} as const;

export const PROJECTILE = { w: 1, h: 1 } as const;

// The five-level demo ladder (ADR 0024 §5): a short climb whose rungs double as the
// mechanics tutorial (one verb per level). `levelCap` is a hard ceiling the level-up
// loop can never cross.
export const PROGRESSION = {
	levelCap: 5,
	// EXP L→L+1 is `xpBase * xpGrowth^(L-1)` — a geometric ramp doubling each rung (60 /
	// 120 / 240 / 480, 900 to cap). `xpToNext` in progression.ts is the source of truth (#266).
	xpBase: 60,
	xpGrowth: 2,
	// Survivability is the level's baseline reward; raw attack power arrives as gated verbs,
	// not damage creep, keeping weapons the only damage stat (ADR 0024). Doubles L1→L5.
	baseHp: 100,
	hpPerLevel: 25,
} as const;

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const;

export const TOWN = { w: 80 } as const;

// Inferred-dimension cap for a parsed `.zone` grid (ADR 0008) — guards typos /
// runaway files. Generous vs the shipped 240×40 Field.
export const ZONE_MAX = { w: 2000, h: 200 } as const;

// Where a forgiving death drops the Avatar back into Town — the Town entrance (story 23).
export const TOWN_SPAWN = { x: 12, y: GROUND_TOP - BOX.h } as const;

export const RESPAWN = { delaySec: 5 } as const;

// In-world instanced loot Drops (#238, ADR 0024 §2): private per owner, collected on
// touch. `pickup` is wider than a body (BOX.w) so a Drop underfoot is forgiving to grab;
// `ttlSec` is how long it rests before fading.
export const LOOT = {
	pickup: { w: BOX.w + 4, h: BOX.h },
	ttlSec: 30,
} as const;

// Base XP a kill yields, by archetype (#266). Scaled by the Zone depth multiplier
// (ZONE_XP_MULT) at award time (see xpForKill), so the same Monster pays more the deeper
// you fight it. Non-combat types earn nothing.
export const MONSTER_XP: Record<EntityType, number> = {
	player: 0,
	chaser: 5, // Slime — the Field-1 warm-up
	shooter: 8, // Sporeling — the ranged poker of the deeper Fields
	brute: 14, // Golem — the elite Field-3 bruiser
} as const;

// Per-Zone XP depth multiplier (#266): Fields pay more the further from the hub (so
// Field 1 never power-levels); the Dungeon is the reliable top faucet. Unlisted → ×1.
export const ZONE_XP_MULT: Record<string, number> = {
	'field-01': 1,
	'field-02': 1.5,
	'field-03': 2,
	'dungeon-01': 2.5,
} as const;

// Max length of a Chat line, shared by input cap, relay clamp, log, and Speech bubble
// (#59, ADR 0007). Kept low so a full message wraps to a bubble that fits on screen.
export const CHAT_MAX_LEN = 120;
