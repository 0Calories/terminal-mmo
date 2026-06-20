// skills.ts — the Warrior Skill system (PRD story 22; CONTEXT: Class — Warrior).
// Skills are Class-bound, unlock by level, fire from a key-bound slot on a
// cooldown, and resolve their effect through the same hitbox / aabbOverlap model
// as basic melee (combat.ts). Pure + deterministic, like the rest of @mmo/shared.

import { BOX } from './constants';
import type { Box, Entity } from './types';

/** A playable Class (CONTEXT: Class). MVP ships Warrior only. */
export type PlayerClass = 'warrior';

/** A Class Skill: gated by level, fired from a slot, dealing damage in a frontal
 * hitbox on a cooldown. Richer effects (i-frame dash, AoE) come post-MVP. */
export interface Skill {
	id: string;
	name: string;
	unlockLevel: number; // usable only at or above this level
	cooldown: number; // seconds before it can fire again
	damage: number;
	reach: number; // how far the frontal hitbox extends (cells)
}

/** Power Strike — a wide, heavy frontal hit. The Warrior's first Skill: harder
 * and longer-reaching than a basic swing, traded against a long cooldown. */
export const POWER_STRIKE: Skill = {
	id: 'power-strike',
	name: 'Power Strike',
	unlockLevel: 2,
	cooldown: 2.5,
	damage: 20,
	reach: 9,
};

/** Warrior Skills in slot order (slot 1 = index 0). */
export const WARRIOR_SKILLS: readonly Skill[] = [POWER_STRIKE];

const SKILLS_BY_CLASS: Record<PlayerClass, readonly Skill[]> = {
	warrior: WARRIOR_SKILLS,
};

/** The Skill bound to a 1-based slot for a Class, or undefined if empty. Slot
 * binding is independent of level — unlock gating (skillUnlocked) is separate. */
export function skillForSlot(
	cls: PlayerClass,
	slot: number,
): Skill | undefined {
	return SKILLS_BY_CLASS[cls]?.[slot - 1];
}

/** Whether a level meets a Skill's unlock requirement. */
export function skillUnlocked(skill: Skill, level: number): boolean {
	return level >= skill.unlockLevel;
}

/** Frontal hitbox for a Skill — the forgiving melee arc (combat.meleeHitbox),
 * widened to the Skill's reach so effects resolve through the same model. */
export function skillHitbox(e: Entity, skill: Skill): Box {
	return {
		x: e.facing === 1 ? e.x + BOX.w : e.x - skill.reach,
		y: e.y,
		w: skill.reach,
		h: BOX.h,
	};
}
