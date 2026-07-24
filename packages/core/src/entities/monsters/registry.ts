import type { EntityType, MonsterType } from '../types';
import { brute } from './brute';
import { chaser } from './chaser';
import type { CombatEngine, MonsterSpec } from './shared';
import { shooter } from './shooter';
import { slime } from './slime';

/** Every monster's complete definition, exhaustively keyed by monster type. */
export const MONSTERS: Record<MonsterType, MonsterSpec> = {
	slime,
	chaser,
	brute,
	shooter,
};

/** The Combat engine an entity fights with; players have none. */
export function combatOf(type: EntityType | undefined): CombatEngine | null {
	return type === undefined || type === 'player' ? null : MONSTERS[type].combat;
}
