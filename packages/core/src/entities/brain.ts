// Monster Brains — the decision layer (ADR 0034). A Brain's entire output is
// a decision, never an effect: `brain(entity, view) → { drive, ai }`. Each
// archetype is one small state machine over its profile's ability table
// (patrol/chase/strike for the melee kinds; patrol/reposition/attack for the
// shooter). Nothing outside a Brain initiates an attack; a Brain never applies
// damage, never moves anything, and its `ai` memory is private to it — the
// tick threads it through opaquely and it never crosses the wire.

// A Brain's output type is physics-owned: the Drive is the shared decision
// packet every controller (Intent or Brain) feeds into the step (ADR 0032).
import { type Drive, IDLE_DRIVE } from '../physics/physics';
import { isSolid, isWall } from '../physics/terrain';
import {
	ARCHETYPES,
	BOX,
	type MeleeProfile,
	type RangedProfile,
} from './archetypes';
import type { Entity, Facing, MonsterType, Terrain } from './types';

/** The limited slice of its Zone a Brain may perceive. */
export interface BrainView {
	terrain: Terrain;
	/** Nearest Avatar's x, or null when the Zone holds none. */
	targetX: number | null;
}

export interface BrainResult {
	drive: Drive;
	/** Next tick's private memory (stored on Entity.ai) — opaque outside this Brain. */
	ai: unknown;
}

export type Brain = (m: Entity, view: BrainView) => BrainResult;

// Patrol: walk the current facing, turn at a wall or a ledge. Probed pre-step
// from the Brain's view of the terrain (the Brain decides; physics executes).
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

// The one perception every FSM shares: the signed and absolute gap to the target.
function gapTo(
	m: Entity,
	targetX: number | null,
): { dx: number; adx: number } | null {
	if (targetX === null) return null;
	const dx = targetX - m.x;
	return { dx, adx: Math.abs(dx) };
}

const toward = (dx: number): Facing => (dx >= 0 ? 1 : -1);

// Melee FSM (chaser, brute): patrol → chase inside aggro → commit `swing` in
// range once off cooldown. States re-derive from distance each tick, so no
// memory is needed; `ai` threads through untouched.
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

/** The shooter Brain's explicit states — recorded in its private `ai` memory. */
export type ShooterState = 'patrol' | 'reposition' | 'attack';
interface ShooterAi {
	state: ShooterState;
}

function shooterAi(ai: unknown): ShooterAi {
	return typeof ai === 'object' && ai !== null && 'state' in ai
		? (ai as ShooterAi)
		: { state: 'patrol' };
}

// Hysteresis at the band's inner edge: a repositioning shooter opens a little
// MORE than keepDist before it settles into attack. The prior state — its ai
// memory — decides, so the FSM cannot flip-flop on the boundary (this is the
// sequencing ADR 0034 kept memory for: "reposition, THEN attack").
const SETTLE_MARGIN = 2;

// Shooter FSM: patrol outside aggro; inside aggro, reposition until the target
// sits in the comfort band [keepDist, aggro), and ONLY the attack state may
// commit `fire` — a crowded shooter backs off first instead of firing
// point-blank (the deliberate behavior fix of ADR 0034).
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

// One Brain per Monster archetype (ADR 0034): adding an archetype = one
// profile in ARCHETYPES + one entry here; the tick and combat stay untouched.
export const BRAINS: Record<MonsterType, Brain> = {
	chaser: meleeBrain(ARCHETYPES.chaser.melee),
	brute: meleeBrain(ARCHETYPES.brute.melee),
	shooter: shooterBrain(ARCHETYPES.shooter.ranged),
};
