import type { Terrain } from '../entities/types';
import { sweepPoint } from './sweep';
import { isWall } from './terrain';

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

	if (isWall(t, Math.floor(p.x), Math.floor(p.y))) return null;
	const x = p.x + p.vx * dt;
	const y = p.y + p.vy * dt;
	if (sweepPoint(t, p.x, p.y, x, y)) return null;
	return { ...p, x, y, life };
}
