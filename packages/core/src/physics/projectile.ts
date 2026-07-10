// projectile — the point-body integrator: straight-line travel and lifetime
// under the shared sweep. A projectile's travel is physics; what it damages —
// its spawn payload and Strike emission — stays combat's business (ADR 0032).

import type { Terrain } from '../entities/types';
import { sweepPoint } from './sweep';
import { isWall } from './terrain';

/**
 * The structural slice of a Projectile its travel touches (ADR 0032): a point
 * body with a lifetime. The damage payload rides through the generic —
 * callers pass a full Projectile and get one back.
 */
export interface PointBody {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
}

export function stepProjectile<P extends PointBody>(
	t: Terrain,
	p: P,
	dt: number,
): P | null {
	const life = p.life - dt;
	if (life <= 0) return null;
	// A shot embedded in a wall (spawned muzzle-flush against one) dies where
	// it is rather than piercing out through it.
	if (isWall(t, Math.floor(p.x), Math.floor(p.y))) return null;
	const x = p.x + p.vx * dt;
	const y = p.y + p.vy * dt;
	if (sweepPoint(t, p.x, p.y, x, y)) return null;
	return { ...p, x, y, life };
}
