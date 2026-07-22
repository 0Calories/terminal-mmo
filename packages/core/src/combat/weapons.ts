import { COMBAT } from './constants';

export interface Weapon {
	name: string;
	damage: number;
	sprite: string;
}

export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		damage: COMBAT.meleeDamage,
		sprite: 'sword',
	},
];

export const DEFAULT_WEAPON = 0;

export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
