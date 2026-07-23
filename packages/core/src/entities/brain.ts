import { type Drive, IDLE_DRIVE } from '../physics/physics';
import { isSolid, isWall } from '../physics/terrain';
import {
	ARCHETYPES,
	BOX,
	type MeleeProfile,
	type RangedProfile,
} from './archetypes';
import type { Entity, Facing, MonsterType, Terrain } from './types';

export interface BrainView {
	terrain: Terrain;

	targetX: number | null;
}

export interface BrainResult {
	drive: Drive;

	ai: unknown;
}

export type Brain = (m: Entity, view: BrainView) => BrainResult;

function patrolDrive(m: Entity, t: Terrain): Drive {
	const dir = m.facing;
	if (!m.onGround) return { moveX: dir, jump: false };
	const top = Math.floor(m.y);
	const bot = Math.ceil(m.y + BOX.h) - 1;
	const wallCol = dir === 1 ? Math.ceil(m.x + BOX.w) : Math.floor(m.x) - 1;
	let wallAhead = false;
	for (let cy = top; cy <= bot; cy++)
		if (isWall(t, wallCol, cy)) {
			wallAhead = true;
			break;
		}
	const lead = dir === 1 ? Math.ceil(m.x + BOX.w) - 1 : Math.floor(m.x);
	const footY = Math.ceil(m.y + BOX.h);
	const turn = wallAhead || !isSolid(t, lead, footY);
	return { moveX: turn ? (dir === 1 ? -1 : 1) : dir, jump: false };
}

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

const toward = (dx: number): Facing => (dx >= 0 ? 1 : -1);

function meleeBrain(p: MeleeProfile): Brain {
	return (m, view) => {
		if (stunned(m) || committed(m)) return { drive: IDLE_DRIVE, ai: m.ai };
		const gap = gapTo(m, view.targetX);
		let drive: Drive;
		if (gap && gap.adx < p.aggro)
			drive = {
				moveX: gap.adx < p.deadzone ? 0 : gap.dx > 0 ? 1 : -1,
				jump: false,
			};
		else drive = patrolDrive(m, view.terrain);
		if (gap && gap.adx <= p.range && (m.attackCdT ?? 0) <= 0)
			drive = { ...drive, face: toward(gap.dx), commit: 'swing' };
		return { drive, ai: m.ai };
	};
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
	slime: (m) => ({ drive: IDLE_DRIVE, ai: m.ai }),
	chaser: meleeBrain(ARCHETYPES.chaser.melee),
	brute: meleeBrain(ARCHETYPES.brute.melee),
	shooter: shooterBrain(ARCHETYPES.shooter.ranged),
};
