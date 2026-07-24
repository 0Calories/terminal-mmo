import type {
	CombatEngine,
	MonsterComposition,
	MonsterSpec,
	MonsterStats,
	MovementEngine,
} from './skeleton';
import { skeletonBrain } from './skeleton';

/**
 * An engine invocation waiting on the sheet that hires it. Engine factories
 * take overrides only; the stats they need are handed down at definition time,
 * so no number is written twice.
 */
export type MovementBuild = (stats: MonsterStats) => MovementEngine;

export type CombatBuild = (stats: MonsterStats) => CombatEngine;

export interface MonsterSheet {
	stats: MonsterStats;
	movement: MovementBuild;
	combat: CombatBuild;
}

/** A monster's whole definition: a character sheet and the two engines it hires. */
export function defineMonster(sheet: MonsterSheet): MonsterSpec {
	const composition: MonsterComposition = {
		stats: sheet.stats,
		movement: sheet.movement(sheet.stats),
		combat: sheet.combat(sheet.stats),
	};
	return { ...composition, brain: skeletonBrain(composition) };
}
