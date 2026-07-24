import type { MonsterType } from '../types';
import { bruteSpec } from './brute';
import { chaserSpec } from './chaser';
import type { MonsterSpec } from './shared';
import { shooterSpec } from './shooter';
import { slimeSpec } from './slime';

/** Every monster's complete definition, exhaustively keyed by monster type. */
export const MONSTERS: Record<MonsterType, MonsterSpec> = {
	slime: slimeSpec,
	chaser: chaserSpec,
	brute: bruteSpec,
	shooter: shooterSpec,
};
