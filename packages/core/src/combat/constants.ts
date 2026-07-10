export const COMBAT = {
	meleeReach: 6,
	meleeDamage: 8,
	swing: { windup: 0.1, active: 0.12, recovery: 0.16 },
	iframes: 0.6,
	dodge: { active: 0.18, recovery: 0.22, impulse: 90, up: 10, cooldown: 0.8 },
	poiseDamage: 8,
	hitstun: 0.35,
	knockback: 40,
	knockbackUp: 14,
	poise: { max: 16, regen: 12, regenDelay: 0.6 } as const,
	guard: {
		blockChip: 0.25,
		blockPoise: 6,
		heldClamp: 1,
	} as const,
	deathBurstIntensity: 30,
} as const;

export const PROJECTILE = { w: 1, h: 1 } as const;
