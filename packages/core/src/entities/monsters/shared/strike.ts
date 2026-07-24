import { COMBAT } from '../../../combat/constants';
import type { Box, Entity, Strike } from '../../types';

/** The numbers a melee Combat engine's active window puts on its Strike. */
export interface MeleeStrikeShape {
	damage: number;
	poiseDamage: number;

	/** Scales the shared melee impulse. */
	knockback: number;
}

/** The impulse a melee Strike carries at the given scale over the shared one. */
export function meleeKnockback(scale: number): {
	knockback: number;
	knockbackUp: number;
} {
	return {
		knockback: COMBAT.knockback * scale,
		knockbackUp: COMBAT.knockbackUp * scale,
	};
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
		...meleeKnockback(shape.knockback),
	};
}
