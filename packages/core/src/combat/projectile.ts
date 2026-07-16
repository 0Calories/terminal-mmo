import { ARCHETYPES, BOX } from '../entities/archetypes';
import type { Box, Entity, Facing, Projectile } from '../entities/types';
import { PROJECTILE } from './constants';

export function projectileBox(p: Projectile): Box {
	return { x: p.x, y: p.y, w: PROJECTILE.w, h: PROJECTILE.h };
}

export function spawnProjectile(
	id: number,
	owner: Entity,
	dir: Facing,
): Projectile {
	const spec = ARCHETYPES.shooter.ranged.projectile;
	return {
		id,
		x: dir === 1 ? owner.x + BOX.w : owner.x - PROJECTILE.w,
		y: owner.y + Math.floor((BOX.h - PROJECTILE.h) / 2),
		vx: dir * spec.speed,
		vy: 0,
		life: spec.life,
		damage: spec.damage,
		poiseDamage: spec.poise,
		knockback: spec.knockback,
		knockbackUp: spec.knockbackUp,
	};
}
