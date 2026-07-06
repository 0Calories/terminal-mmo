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
	// Horizontal friction on the external-impulse channel (knockback shove): an
	// exponential decay rate (per second). Tuned snappy/arcade (ADR 0017) so a
	// shove dies out in a few hundred ms rather than sliding floatily. Only the
	// impulse channel decays; input-driven horizontal velocity is unaffected.
	drag: 8,
	// Below this magnitude an impulse velocity snaps to 0, so a body doesn't creep
	// forever on an asymptotically-tiny residual.
	impulseEpsilon: 0.01,
} as const;

// Default Mass for a body whose Entity leaves it unset (ADR 0017). 1 is neutral:
// an impulse divided by mass 1 is itself. Per-entity Mass tuning (heavy ogres,
// light Slimes) is balance work deferred with the rest of the Knockback slice.
export const DEFAULT_MASS = 1;

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
	// The Dodge (ADR 0017 §5): a short horizontal hop that grants i-frames for its
	// `active` window then leaves the Avatar exposed through `recovery` (committal —
	// it can't be re-entered until the whole hop ends, so it isn't a free panic
	// button). The hop itself is a momentum-body impulse (`impulse` horizontal + a
	// small `up` pop), reusing the same Knockback channel + drag the Stagger shove
	// does. This is the first EARNED invulnerability after automatic post-hit i-frames
	// were removed in #163. Durations are chunky enough to survive 30 Hz input
	// quantization (ADR 0017 §11); the active window is shorter than the recovery, so
	// a mistimed Dodge is punishable. `cooldown` is the extra lockout AFTER recovery
	// ends before another hop can start — the spam-gate, anchored at dodge start as a
	// single `dodgeCdT` lockout of (active + recovery + cooldown) = 1.2s.
	dodge: { active: 0.18, recovery: 0.22, impulse: 90, up: 10, cooldown: 0.8 },
	// The universal hit-reaction payload a landed basic swing carries (ADR 0017 §2):
	// it always deals `meleeDamage` HP, chips `poiseDamage` off the victim's Poise,
	// and — only on a Poise break — Staggers (Hitstun locks control) and Knocks back
	// (a momentum-body impulse, scaled by Mass in applyImpulse).
	poiseDamage: 8,
	hitstun: 0.35, // seconds the victim's control is locked on Stagger (body still flies)
	knockback: 40, // horizontal Knockback impulse on a break (÷ Mass in applyImpulse)
	knockbackUp: 14, // a small upward pop on a break, so a Stagger lifts as well as shoves
	// Per-entity Poise (ADR 0017 §3): an accumulating pool that depletes by an
	// attack's poiseDamage per hit and regenerates ONLY under no pressure. Stagger
	// fires when a hit drives the pool to 0 (a break refills it). Wind-up grants
	// Super-armor (a break is suppressed while an attacker is in its own wind-up).
	//
	// Tuned so the break is OBSERVABLE before the kill: a default chaser (24 HP) dies
	// in 3 melee hits (8 dmg) but breaks on the 2nd (max 16 ÷ 8 poise), so a sustained
	// flurry reads chip → Stagger+fly → kill rather than break-and-die-at-once. The
	// regen is GATED behind `regenDelay`: under a flurry (hits closer together than
	// the delay) Poise purely accumulates and reliably breaks, while spaced-out pokes
	// let it recover — the "sustained pressure breaks you" rhythm the ADR requires. An
	// always-on regen instead refilled the pool between swings and the break never came.
	poise: { max: 16, regen: 12, regenDelay: 0.6 } as const,
	// Guard (ADR 0017 §5, ADR 0024): one held input. Any raised Guard is a Block — a
	// frontal brace that chips HP and drains Poise toward a guard-break (Parry removed).
	guard: {
		// A Block reduces a frontal hit to this fraction of its HP damage (chip)…
		blockChip: 0.25,
		// …and drains this much Poise per blocked hit toward a guard-break. Tuned so a
		// committer's hit breaks a turtling Player's pool (max 16) after a few blocks —
		// turtling is punished by the Poise system, no separate guard meter (ADR 0017 §5).
		blockPoise: 6,
		// The held-Guard timer (`guardT`) counts up while held; its magnitude no longer
		// gates anything (any positive value is a Block), so it is clamped here purely to
		// keep an indefinite hold from growing the scalar unbounded.
		heldClamp: 1,
	} as const,
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
	// The reworked chaser is a MELEE COMMITTER (ADR 0017 §9): it has no passive
	// contact damage. When an Avatar comes within `meleeRange` it COMMITS a
	// telegraphed swing (the shared wind-up→active→recovery phase machine) and deals
	// `meleeDamage` ONLY during the active phase, carrying the full hit-reaction
	// payload (Poise + Stagger on a break). `meleeRange` is kept just inside the
	// hitbox reach so the active strike connects on a target that holds its ground,
	// while the wind-up gives a reading Player the window to step out and punish the
	// recovery. `meleeDamage` is a touch heavier than the retired contact chip (6),
	// since it is now telegraphed and avoidable rather than unavoidable.
	meleeDamage: 8,
	meleeRange: 4,
} as const;

export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46,
	keepDist: 20, // retreats if the Avatar comes closer than this
	// Seconds between telegraphed shots (ADR 0017 §8): the reworked shooter is a RANGED
	// POKER — it COMMITS the shared wind-up→active→recovery swing and fires ONE shot on
	// the active frame, never auto-firing. This paces the next commit so a reading Player
	// has time to react to the telegraph, dodge/block/swat the shot, or close in to punish
	// the recovery. Generous vs the swing total (~0.38s) so the cadence stays readable.
	fireCooldown: 1.4,
	// Travel speed (cells/s): deliberately reactable, NOT hitscan (ADR 0017 §8) — slow
	// enough that a Player can visibly respond AFTER the wind-up telegraph.
	projSpeed: 30,
	projLife: 2.4,
	// The pebble's hit-reaction payload (ADR 0017 §8): light HP + a small Poise bite that
	// only Staggers under sustained fire, and a modest Knockback thrown on that break —
	// the same payload shape a melee hit carries, so the shot resolves through one path.
	projDamage: 7,
	projPoise: 6,
	projKnockback: 30,
	projKnockbackUp: 10,
} as const;

export const PROJECTILE = { w: 1, h: 1 } as const;

// The five-level demo ladder (ADR 0024 §5): a short, hand-paced climb whose rungs
// double as the mechanics tutorial (one verb per level). `levelCap` is a hard ceiling
// the level-up loop can never cross. The EXP curve and per-level HP scaling below are
// tuned for this arc — not the retired 30-level MVP — so the Dungeon faucet is a sane,
// reliable climb rather than a wall (ADR 0024 amendment §3).
export const PROGRESSION = {
	levelCap: 5,
	// EXP to advance from level L to L+1 is `xpBase * L` — a gentle arithmetic ramp
	// (each level costs `xpBase` more than the last: 40 / 80 / 120 / 160, 400 total to
	// cap). At `XP_PER_KILL` that is ~20 Dungeon kills to cap — a couple of runs.
	xpBase: 40,
	// Per-level HP scaling: survivability is the level's baseline reward (raw attack
	// power arrives as the gated verbs — Power Strike, Ground Pound — not a flat damage
	// creep, keeping weapons the only damage stat per ADR 0024). Doubles L1→L5.
	baseHp: 100,
	hpPerLevel: 25,
} as const;

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

// The Dungeon faucet's per-kill XP grant (ADR 0024 §2). Sized against the reworked
// EXP curve so cap 5 (400 XP total) lands in ~20 kills — a reliable, unfrustrating
// climb of a couple of Dungeon runs, not a long grind.
export const XP_PER_KILL = 20;

// Max length of a Chat line, shared by the input cap, the server relay clamp, the
// chat log, and the over-head Speech bubble (#59, ADR 0007). Kept low enough that a
// full-length message wraps to a bubble that fits on screen.
export const CHAT_MAX_LEN = 120;
