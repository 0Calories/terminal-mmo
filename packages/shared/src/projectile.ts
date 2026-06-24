import { BOX, PROJECTILE, SHOOTER } from './constants';
import { isSolid } from './terrain';
import type { Box, Entity, Facing, Projectile, Terrain } from './types';

export function projectileBox(p: Projectile): Box {
	return { x: p.x, y: p.y, w: PROJECTILE.w, h: PROJECTILE.h };
}

// Spawn a shooter's telegraphed pebble (ADR 0017 §8): launched ahead of the owner in
// `dir`, carrying the full SHOOTER hit-reaction payload (damage + Poise + Knockback) so
// it resolves through the same gate a melee hit does. Faction `monster` — it threatens
// Avatars until a Parry reflects it (which flips the faction in stepZone).
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
		poiseDamage: SHOOTER.projPoise,
		knockback: SHOOTER.projKnockback,
		knockbackUp: SHOOTER.projKnockbackUp,
		faction: 'monster',
		ownerId: owner.id,
	};
}

// Returns null on despawn (lifetime expired or entered solid Terrain).
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
