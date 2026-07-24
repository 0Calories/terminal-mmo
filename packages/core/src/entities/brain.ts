import { type Drive, IDLE_DRIVE } from '../physics/physics';
import { ARCHETYPES, type RangedProfile } from './archetypes';
import { bruteBrain } from './monsters/brute';
import { chaserBrain } from './monsters/chaser';
import { patrolDrive, toward } from './monsters/shared';
import { slimeBrain } from './monsters/slime';
import type { Entity, MonsterType, Terrain } from './types';

export interface BrainView {
	terrain: Terrain;

	targetX: number | null;
}

export interface BrainResult {
	drive: Drive;

	ai: unknown;
}

export type Brain = (m: Entity, view: BrainView) => BrainResult;

const stunned = (m: Entity) => (m.stunT ?? 0) > 0;
const committed = (m: Entity) => m.attackT > 0;

function gapTo(
	m: Entity,
	targetX: number | null,
): { dx: number; adx: number } | null {
	if (targetX === null) return null;
	const dx = targetX - m.x;
	return { dx, adx: Math.abs(dx) };
}

export type ShooterState = 'patrol' | 'reposition' | 'attack';
interface ShooterAi {
	state: ShooterState;
}

function shooterAi(ai: unknown): ShooterAi {
	return typeof ai === 'object' && ai !== null && 'state' in ai
		? (ai as ShooterAi)
		: { state: 'patrol' };
}

const SETTLE_MARGIN = 2;

function shooterBrain(p: RangedProfile): Brain {
	return (m, view) => {
		const ai = shooterAi(m.ai);
		if (stunned(m) || committed(m)) return { drive: IDLE_DRIVE, ai };
		const gap = gapTo(m, view.targetX);
		if (!gap || gap.adx >= p.aggro)
			return { drive: patrolDrive(m, view.terrain), ai: { state: 'patrol' } };
		const face = toward(gap.dx);
		const settleAt =
			ai.state === 'reposition' ? p.keepDist + SETTLE_MARGIN : p.keepDist;
		if (gap.adx < settleAt)
			return {
				drive: { moveX: gap.dx > 0 ? -1 : 1, jump: false, face },
				ai: { state: 'reposition' },
			};
		const drive: Drive = { moveX: 0, jump: false, face };
		if ((m.attackCdT ?? 0) <= 0)
			return { drive: { ...drive, commit: 'fire' }, ai: { state: 'attack' } };
		return { drive, ai: { state: 'attack' } };
	};
}

export const BRAINS: Record<MonsterType, Brain> = {
	slime: slimeBrain,
	chaser: chaserBrain,
	brute: bruteBrain,
	shooter: shooterBrain(ARCHETYPES.shooter.ranged),
};
