import { BOX } from './constants';
import type { Box, Entity } from './types';

export type PlayerClass = 'warrior';

export interface Skill {
	id: string;
	name: string;
	unlockLevel: number;
	cooldown: number; // seconds
	damage: number;
	reach: number; // cells the frontal hitbox extends
}

export const POWER_STRIKE: Skill = {
	id: 'power-strike',
	name: 'Power Strike',
	unlockLevel: 1, // temporarily L1 so the feel is testable from spawn; bump once signed off
	cooldown: 2.5,
	damage: 20,
	reach: 9,
};

// slot 1 = index 0
export const WARRIOR_SKILLS: readonly Skill[] = [POWER_STRIKE];

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

export function skillHitbox(e: Entity, skill: Skill): Box {
	return {
		x: e.facing === 1 ? e.x + BOX.w : e.x - skill.reach,
		y: e.y,
		w: skill.reach,
		h: BOX.h,
	};
}
