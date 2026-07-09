import { COMBAT } from './constants';
import { sword, type WeaponSprite } from './sprites';

// A Weapon contributes damage + visuals only; the WEAPONS index is the wire-replicated id.
export interface Weapon {
	name: string;
	damage: number;
	sprite?: WeaponSprite;
}

export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		damage: COMBAT.meleeDamage,
		sprite: sword,
	},
];

export const DEFAULT_WEAPON = 0;

// An absent, out-of-range, or forward-version index falls back to the default sword.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
