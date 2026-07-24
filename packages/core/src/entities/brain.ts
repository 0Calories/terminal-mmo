import type { Drive } from '../physics/physics';
import { bruteBrain } from './monsters/brute';
import { chaserBrain } from './monsters/chaser';
import type { MonsterMemory } from './monsters/shared';
import { shooterBrain } from './monsters/shooter';
import { slimeBrain } from './monsters/slime';
import type { Entity, MonsterType, Terrain } from './types';

export interface BrainView {
	terrain: Terrain;

	targetX: number | null;
}

export interface BrainResult {
	drive: Drive;

	ai: MonsterMemory;
}

export type Brain = (m: Entity, view: BrainView) => BrainResult;

export const BRAINS: Record<MonsterType, Brain> = {
	slime: slimeBrain,
	chaser: chaserBrain,
	brute: bruteBrain,
	shooter: shooterBrain,
};
