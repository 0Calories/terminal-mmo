import type { Drive } from '../../../physics/physics';
import { isSolid, isWall } from '../../../physics/terrain';
import { boxOf } from '../../boxes';
import type { Entity, Facing, Terrain } from '../../types';
import type { MovementBuild } from './sheet';
import type { BrainView, MovementEngine } from './skeleton';

export interface WalkShape {
	/** How close to a destination the walk stands still. */
	deadzone: number;
}

/** Walk's founding monster is the chaser. */
export const WALK_DEFAULTS: WalkShape = { deadzone: 2 };

export function wallAhead(m: Entity, t: Terrain, dir: Facing): boolean {
	const box = boxOf(m.type);
	const top = Math.floor(m.y);
	const bot = Math.ceil(m.y + box.h) - 1;
	const wallCol = dir === 1 ? Math.ceil(m.x + box.w) : Math.floor(m.x) - 1;
	for (let cy = top; cy <= bot; cy++) if (isWall(t, wallCol, cy)) return true;
	return false;
}

export function footProbe(
	m: Entity,
	dir: Facing,
): { lead: number; footY: number } {
	const box = boxOf(m.type);
	return {
		lead: dir === 1 ? Math.ceil(m.x + box.w) - 1 : Math.floor(m.x),
		footY: Math.ceil(m.y + box.h),
	};
}

export function patrolDrive(m: Entity, t: Terrain): Drive {
	const dir = m.facing;
	if (!m.onGround) return { moveX: dir, jump: false };
	const { lead, footY } = footProbe(m, dir);
	const turn = wallAhead(m, t, dir) || !isSolid(t, lead, footY);
	return { moveX: turn ? (dir === 1 ? -1 : 1) : dir, jump: false };
}

/** Ground gait: patrols a ledge-and-wall-probed line, walks straight at a destination. */
export function walkEngine(overrides: Partial<WalkShape> = {}): MovementBuild {
	const shape: WalkShape = { ...WALK_DEFAULTS, ...overrides };
	const engine: MovementEngine = {
		wander: (m: Entity, view: BrainView) => ({
			drive: patrolDrive(m, view.terrain),
		}),
		moveToward: (m: Entity, _view: BrainView, destX: number) => {
			const dx = destX - m.x;
			return {
				drive: {
					moveX: Math.abs(dx) < shape.deadzone ? 0 : dx > 0 ? 1 : -1,
					jump: false,
				},
			};
		},
	};
	return () => engine;
}
