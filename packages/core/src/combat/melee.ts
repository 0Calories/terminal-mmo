import { boxOf } from '../entities/boxes';
import type {
	AttackPhase,
	AttackPhaseTimings,
	Box,
	EntityType,
	Facing,
} from '../entities/types';
import { COMBAT } from './constants';

export function attackTotal(tm: AttackPhaseTimings): number {
	return tm.windup + tm.active + tm.recovery;
}

export function attackPhaseAt(
	attackT: number,
	tm: AttackPhaseTimings,
): AttackPhase | null {
	if (attackT <= 0) return null;
	const elapsed = attackTotal(tm) - attackT;
	if (elapsed < tm.windup) return 'windup';
	if (elapsed < tm.windup + tm.active) return 'active';
	return 'recovery';
}

export function attackProgressAt(
	attackT: number,
	tm: AttackPhaseTimings,
): number {
	const phase = attackPhaseAt(attackT, tm);
	if (!phase) return 0;
	const { windup, active, recovery } = tm;
	const elapsed = attackTotal(tm) - attackT;
	if (phase === 'windup') return windup > 0 ? elapsed / windup : 1;
	if (phase === 'active') return active > 0 ? (elapsed - windup) / active : 1;
	return recovery > 0 ? (elapsed - windup - active) / recovery : 1;
}

export const SWING_TOTAL = attackTotal(COMBAT.swing);

export function swingPhase(attackT: number): AttackPhase | null {
	return attackPhaseAt(attackT, COMBAT.swing);
}

export function swingProgress(attackT: number): number {
	return attackProgressAt(attackT, COMBAT.swing);
}

export function meleeActive(attackT: number): boolean {
	return swingPhase(attackT) === 'active';
}

export function entityBox(e: { x: number; y: number; type?: EntityType }): Box {
	const box = boxOf(e.type);
	return { x: e.x, y: e.y, w: box.w, h: box.h };
}

/** The authored melee reach, swung beside the attacker's own logical box. */
export function meleeHitbox(p: {
	x: number;
	y: number;
	facing: Facing;
	type?: EntityType;
}): Box {
	const box = boxOf(p.type);
	const w = COMBAT.meleeReach;
	return {
		x: p.facing === 1 ? p.x + box.w : p.x - w,
		y: p.y,
		w,
		h: box.h,
	};
}
