import { boxOf } from '../entities/boxes';
import type { Box, Entity, Facing, Projectile } from '../entities/types';
import { PROJECTILE } from './constants';

/** Everything a shot carries, decided by the Combat engine that releases it. */
export interface ProjectileSpec {
	speed: number;
	life: number;
	damage: number;
	poiseDamage: number;
	knockback: number;
	knockbackUp: number;
}

export function projectileBox(p: Projectile): Box {
	return { x: p.x, y: p.y, w: PROJECTILE.w, h: PROJECTILE.h };
}

export function spawnProjectile(
	id: number,
	owner: Entity,
	dir: Facing,
	spec: ProjectileSpec,
): Projectile {
	const box = boxOf(owner.type);
	return {
		id,
		x: dir === 1 ? owner.x + box.w : owner.x - PROJECTILE.w,
		y: owner.y + Math.floor((box.h - PROJECTILE.h) / 2),
		vx: dir * spec.speed,
		vy: 0,
		life: spec.life,
		damage: spec.damage,
		poiseDamage: spec.poiseDamage,
		knockback: spec.knockback,
		knockbackUp: spec.knockbackUp,
	};
}
