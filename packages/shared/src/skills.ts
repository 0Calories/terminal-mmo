import { BOX } from './constants';
import { CAPABILITY_UNLOCK } from './progression';
import type { Box, Entity } from './types';

export type PlayerClass = 'warrior';

// A 'frontal' Skill projects its hitbox in front of the Avatar (a forgiving arc);
// an 'aoe' Skill detonates a box centred on the Avatar, hitting both facings at
// once for crowd control. Undefined kind reads as 'frontal' (back-compat).
export type SkillKind = 'frontal' | 'aoe';

export interface Skill {
	id: string;
	name: string;
	// The canonical keycap shown for this skill (u = slot 1, i = slot 2) — a presentation
	// label kept next to `name`, so the shared "Unlocked: <name> [<key>]!" feedback line
	// (#271, generated server-side where the client's input scheme is unknown) and the HUD
	// readout name one key from one source. This is the DEFAULT keyboard binding; the opt-in
	// mouse scheme (MMO_SCHEME=mouse) rebinds skills to e/r, which only the scheme-aware
	// controls overlay reflects — the demo's feedback line stays on the canonical keycap.
	key: string;
	kind: SkillKind;
	unlockLevel: number;
	cooldown: number; // seconds
	damage: number;
	reach: number; // cells the hitbox extends past the Avatar body
}

export const POWER_STRIKE: Skill = {
	id: 'power-strike',
	name: 'Power Strike',
	key: 'u',
	kind: 'frontal',
	// The Player's first Active skill — the L3 rung of the capability ladder (ADR 0024 §5).
	unlockLevel: CAPABILITY_UNLOCK['power-strike'],
	cooldown: 2.5,
	damage: 20,
	reach: 9,
};

export const GROUND_POUND: Skill = {
	id: 'ground-pound',
	name: 'Ground Pound',
	key: 'i',
	kind: 'aoe',
	// The cap-level (L5) reward — the final rung of the capability ladder (ADR 0024 §5).
	unlockLevel: CAPABILITY_UNLOCK['ground-pound'],
	cooldown: 6,
	damage: 30,
	reach: 7, // extends this far on BOTH sides of the Avatar
};

// slot N = index N-1
export const WARRIOR_SKILLS: readonly Skill[] = [POWER_STRIKE, GROUND_POUND];

const SKILLS_BY_CLASS: Record<PlayerClass, readonly Skill[]> = {
	warrior: WARRIOR_SKILLS,
};

export function skillForSlot(
	cls: PlayerClass,
	slot: number,
): Skill | undefined {
	return SKILLS_BY_CLASS[cls]?.[slot - 1];
}

export function skillUnlocked(skill: Skill, level: number): boolean {
	return level >= skill.unlockLevel;
}

// The Active skills newly unlocked by climbing from `fromLevel` to `toLevel` on a level-up,
// in ladder order — each skill whose unlock rung lands in the half-open span (fromLevel,
// toLevel]. A multi-level jump surfaces every rung it crossed. Drives the cosmetic
// "Unlocked: <name> [<key>]!" feedback line (#271); no mechanics ride on it.
export function skillsUnlockedBetween(
	cls: PlayerClass,
	fromLevel: number,
	toLevel: number,
): readonly Skill[] {
	return (SKILLS_BY_CLASS[cls] ?? []).filter(
		(s) => s.unlockLevel > fromLevel && s.unlockLevel <= toLevel,
	);
}

export function skillHitbox(e: Entity, skill: Skill): Box {
	if (skill.kind === 'aoe') {
		// Centred on the Avatar — extends `reach` past both edges, facing-agnostic.
		return {
			x: e.x - skill.reach,
			y: e.y,
			w: BOX.w + 2 * skill.reach,
			h: BOX.h,
		};
	}
	return {
		x: e.facing === 1 ? e.x + BOX.w : e.x - skill.reach,
		y: e.y,
		w: skill.reach,
		h: BOX.h,
	};
}
