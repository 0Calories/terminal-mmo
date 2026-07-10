// Entity archetype tuning — per-kind footprints and monster stat profiles
// (ADR 0032: monster tuning lives with the entity archetypes, not a constants hub).

export const BOX = { w: 5, h: 5 } as const;

export const MONSTER = {
	chaserHp: 24,
	chaserSpeed: 12,
	chaserAggro: 22,
	chaserDeadzone: 2,
	meleeDamage: 8,
	meleeRange: 4,
} as const;

export const BRUTE = {
	hp: 60,
	speed: 6,
	aggro: 26,
	deadzone: 2,
	mass: 4,
	poiseMax: 48,
	meleeDamage: 18,
	meleePoise: 16,
	meleeRange: 5,
	commitCooldown: 1.6,
} as const;

export const SHOOTER = {
	hp: 16,
	speed: 9,
	aggro: 46,
	keepDist: 20,
	fireCooldown: 1.4,
	projSpeed: 30,
	projLife: 2.4,
	projDamage: 7,
	projPoise: 6,
	projKnockback: 30,
	projKnockbackUp: 10,
} as const;
