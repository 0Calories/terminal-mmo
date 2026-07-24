import { PHYS } from '../physics/constants';
import { type Drive, IDLE_DRIVE } from '../physics/physics';
import { isSolid } from '../physics/terrain';
import {
	ARCHETYPES,
	type MeleeProfile,
	type RangedProfile,
} from './archetypes';
import { bruteBrain } from './monsters/brute';
import { chaserBrain } from './monsters/chaser';
import { footProbe, patrolDrive, toward, wallAhead } from './monsters/shared';
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

interface SlimeAi {
	restT: number;

	/** Which cadence the rest paces — a patrol rest breaks on detection. */
	rest?: 'patrol' | 'approach';

	/** Horizontal scale of the hop in flight — set by whichever drive launched it. */
	hopScale?: number;
}

function slimeAi(ai: unknown): SlimeAi {
	return typeof ai === 'object' && ai !== null && 'restT' in ai
		? (ai as SlimeAi)
		: { restT: 0 };
}

// Rests are counted in Brain calls — one per fixed 16ms zone tick.
const SLIME_REST = { patrol: 25, approach: 6 } as const;

// Traversal hops ride flattened arcs: under-jump the shared impulse and make
// up the ground with extra horizontal speed.
const SLIME_HOP = { speed: 1.35, jump: 0.8 } as const;

// Columns a full hop can carry the slime (scaled speed × ballistic airtime of
// the scaled jump), plus one for the drift of the landing tick.
function hopSpan(speed: number): number {
	return (
		Math.ceil(
			(speed * SLIME_HOP.speed * 2 * PHYS.jump * SLIME_HOP.jump) / PHYS.grav,
		) + 1
	);
}

// Contiguous solid ground ahead of the leading foot, capped at one full hop.
function groundAhead(m: Entity, t: Terrain, dir: Facing, span: number): number {
	const { lead, footY } = footProbe(m, dir);
	let cols = 0;
	while (cols < span && isSolid(t, lead + dir * (cols + 1), footY)) cols++;
	return cols;
}

function slimeBrain(p: MeleeProfile): Brain {
	return (m, view) => {
		if (stunned(m) || committed(m)) return { drive: IDLE_DRIVE, ai: m.ai };
		const ai = slimeAi(m.ai);
		if (!m.onGround)
			return {
				drive: { moveX: m.facing, jump: false, moveScale: ai.hopScale ?? 1 },
				ai,
			};
		const gap = gapTo(m, view.targetX);
		if (gap && gap.adx <= p.range && (m.attackCdT ?? 0) <= 0)
			return {
				drive: {
					moveX: 0,
					jump: false,
					face: toward(gap.dx),
					commit: 'pounce',
				},
				ai: { restT: SLIME_REST.approach, rest: 'approach' },
			};
		const aware = gap !== null && gap.adx < p.aggro;
		if (ai.restT > 0 && !(aware && ai.rest !== 'approach')) {
			const drive: Drive = { moveX: 0, jump: false };
			if (aware && gap) drive.face = toward(gap.dx);
			return { drive, ai: { ...ai, restT: ai.restT - 1 } };
		}
		if (gap && gap.adx < p.aggro) {
			if (gap.adx < p.deadzone) return { drive: { moveX: 0, jump: false }, ai };
			// Approach hops close only to the lip of leap range: the wind-up
			// should start at pouncing distance, never on top of the target.
			const want = Math.max(0, gap.adx - (p.range - 1));
			if (want === 0)
				return { drive: { moveX: 0, jump: false, face: toward(gap.dx) }, ai };
			const hopScale = SLIME_HOP.speed * Math.min(1, want / hopSpan(m.speed));
			return {
				drive: {
					moveX: toward(gap.dx),
					jump: true,
					moveScale: hopScale,
					jumpScale: SLIME_HOP.jump,
				},
				ai: { restT: SLIME_REST.approach, rest: 'approach', hopScale },
			};
		}
		const t = view.terrain;
		const span = hopSpan(m.speed);
		const room = (dir: Facing) =>
			wallAhead(m, t, dir) ? 0 : groundAhead(m, t, dir, span);
		const ahead = room(m.facing);
		const dir: Facing = ahead > 0 ? m.facing : m.facing === 1 ? -1 : 1;
		const cols = ahead > 0 ? ahead : room(dir);
		// The hop is scaled to the ground that can catch it: a full stride in
		// the open, shuffle-hops near an edge, in place when boxed in — but
		// never a freeze.
		const hopScale = (SLIME_HOP.speed * cols) / span;
		return {
			drive: {
				moveX: cols > 0 ? dir : 0,
				jump: true,
				moveScale: hopScale,
				jumpScale: SLIME_HOP.jump,
			},
			ai: { restT: SLIME_REST.patrol, rest: 'patrol', hopScale },
		};
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
	slime: slimeBrain(ARCHETYPES.slime.melee),
	chaser: chaserBrain,
	brute: bruteBrain,
	shooter: shooterBrain(ARCHETYPES.shooter.ranged),
};
