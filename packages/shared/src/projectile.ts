// projectile.ts — ranged-Monster Projectiles (CONTEXT: Combat). Pure +
// deterministic, like the rest of @mmo/shared: a Projectile travels in a
// straight line and despawns on Terrain, on the Avatar, or on lifetime expiry.
import { BOX, PROJECTILE, SHOOTER } from './constants';
import { isSolid } from './terrain';
import type { Box, Entity, Facing, Projectile, Terrain } from './types';

/** The logical hit box of a Projectile (small, decoupled from its glyph). */
export function projectileBox(p: Projectile): Box {
	return { x: p.x, y: p.y, w: PROJECTILE.w, h: PROJECTILE.h };
}

/** Fire a Projectile from a shooter toward `dir`, level with its body centre. */
export function spawnProjectile(
	id: number,
	owner: Entity,
	dir: Facing,
): Projectile {
	return {
		id,
		x: dir === 1 ? owner.x + BOX.w : owner.x - PROJECTILE.w,
		y: owner.y + Math.floor((BOX.h - PROJECTILE.h) / 2),
		vx: dir * SHOOTER.projSpeed,
		vy: 0,
		life: SHOOTER.projLife,
		damage: SHOOTER.projDamage,
		ownerId: owner.id,
	};
}

/** Advance a Projectile one step. Returns null when it despawns — lifetime
 * expired or it entered solid Terrain (which includes the world's bounds). */
export function stepProjectile(
	t: Terrain,
	p: Projectile,
	dt: number,
): Projectile | null {
	const life = p.life - dt;
	if (life <= 0) return null;
	const x = p.x + p.vx * dt;
	const y = p.y + p.vy * dt;
	if (isSolid(t, Math.floor(x), Math.floor(y))) return null;
	return { ...p, x, y, life };
}
