import { COMBAT } from './constants';

// A Weapon contributes damage + stats only; the WEAPONS index is the wire-replicated id
// that also keys the weapon *art* (WeaponSprite) held client-side in @mmo/render.
// `sprite` is the catalog reference (ADR 0031): the id of the `.sprite` file under
// `sprites/weapons/` that carries the art. The wire still replicates the numeric
// index; observers resolve art via `WEAPONS[i].sprite` → the weapon sprite registry.
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

// An absent, out-of-range, or forward-version index falls back to the default sword.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
