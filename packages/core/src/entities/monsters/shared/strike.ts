import type { Box, Entity, Strike } from '../../types';

/** The numbers a melee Combat engine's active window puts on its Strike. */
export interface MeleeStrikeShape {
	damage: number;
	poiseDamage: number;
	knockback: number;
	knockbackUp: number;
}

export function monsterStrike(
	m: Entity,
	hitbox: Box,
	shape: MeleeStrikeShape,
): Strike {
	return {
		attackerId: m.id,
		attackerKind: 'monster',
		hitbox,
		damage: shape.damage,
		poiseDamage: shape.poiseDamage,
		facing: m.facing,
		faction: 'monsters',
		attackerX: m.x,
		knockback: shape.knockback,
		knockbackUp: shape.knockbackUp,
	};
}
