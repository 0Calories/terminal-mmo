import { COMBAT } from './constants';

// A Weapon contributes damage + stats only; the WEAPONS index is the wire-replicated id
// that also keys the weapon *art* (WeaponSprite) held client-side in @mmo/render.
export interface Weapon {
	name: string;
	damage: number;
}

export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		damage: COMBAT.meleeDamage,
	},
];

export const DEFAULT_WEAPON = 0;

// An absent, out-of-range, or forward-version index falls back to the default sword.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
