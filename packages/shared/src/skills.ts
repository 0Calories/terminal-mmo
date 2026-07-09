import { BOX } from './constants';
import { CAPABILITY_UNLOCK } from './progression';
import type { Box, Entity } from './types';

export type PlayerClass = 'warrior';

export type SkillKind = 'frontal' | 'aoe';

export interface Skill {
	id: string;
	name: string;
	// The DEFAULT binding; MMO_SCHEME=mouse rebinds keys but feedback lines stay on this.
	key: string;
	kind: SkillKind;
	unlockLevel: number;
	cooldown: number;
	damage: number;
	reach: number;
}

export const POWER_STRIKE: Skill = {
	id: 'power-strike',
	name: 'Power Strike',
	key: 'u',
	kind: 'frontal',
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
	unlockLevel: CAPABILITY_UNLOCK['ground-pound'],
	cooldown: 6,
	damage: 30,
	reach: 7,
};

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

// Unlock rungs in the half-open span (fromLevel, toLevel], so a multi-level jump surfaces all.
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
