import type { PlayerClass } from './skills';

// --- Moveset abilities: progression-gated passive verbs (ADR 0017 §5, #170) -----
//
// The combat moveset is gated behind progression so a beginner fights simply and grows
// into the "dope combos". Abilities split into two categories:
//   - cooldown ACTIVE skills (Power Strike, Ground Pound) — live in skills.ts, fire on a
//     dedicated slot and tick a cooldown; UNAFFECTED by this gating.
//   - passive MOVESET abilities (below) — always-available verbs once unlocked, no
//     cooldown, gated purely by level. They extend how the basic attack / Guard behave.
//
// A locked Moveset ability simply does not fire when its input is interpreted — a no-op,
// not an error (the gate folds into `resolveCombat` / the Guard hit-resolution). The
// LEVEL-1 FLOOR is therefore: basic attack + hold-Block + Dodge only — no string
// extensions, no Launcher, no aerials, no Spike, no cancels, and Parry is an earned unlock.
//
// Of the six abilities only PARRY is mechanically built today (the Guard slice, #166); the
// rest are reserved curve entries for the combo substrate (#167) so they are already gated
// the moment their mechanics land — no rework, just a `movesetUnlocked` check at the seam.

export type MovesetAbilityId =
	| 'string-extensions'
	| 'launcher'
	| 'aerials'
	| 'spike'
	| 'cancels'
	| 'parry';

export interface MovesetAbility {
	id: MovesetAbilityId;
	name: string;
	unlockLevel: number;
}

// The Warrior unlock curve, in the canonical order (#170): string extensions → Launcher →
// aerials → Spike → cancels → Parry. Strictly ascending unlock levels, so the curve reads
// as the order it unlocks in. Parry is deliberately LAST — the high-skill defensive verb
// is the earned capstone of the moveset, not a level-1 gift.
export const WARRIOR_MOVESET: readonly MovesetAbility[] = [
	{ id: 'string-extensions', name: 'String Extensions', unlockLevel: 2 },
	{ id: 'launcher', name: 'Launcher', unlockLevel: 3 },
	{ id: 'aerials', name: 'Aerials', unlockLevel: 4 },
	{ id: 'spike', name: 'Spike', unlockLevel: 6 },
	{ id: 'cancels', name: 'Cancels', unlockLevel: 7 },
	{ id: 'parry', name: 'Parry', unlockLevel: 8 },
];

const MOVESET_BY_CLASS: Record<PlayerClass, readonly MovesetAbility[]> = {
	warrior: WARRIOR_MOVESET,
};

export function movesetForClass(cls: PlayerClass): readonly MovesetAbility[] {
	return MOVESET_BY_CLASS[cls] ?? [];
}

// Whether an Avatar of the given class + level has unlocked a Moveset ability. An ability
// not on the class curve reads as LOCKED (false) — gating fails safe, so a yet-unwired
// ability can never fire by accident before its curve entry lands.
export function movesetUnlocked(
	ability: MovesetAbilityId,
	level: number,
	cls: PlayerClass = 'warrior',
): boolean {
	const a = MOVESET_BY_CLASS[cls]?.find((m) => m.id === ability);
	return a !== undefined && level >= a.unlockLevel;
}
