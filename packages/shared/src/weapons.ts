import { COMBAT } from './constants';
import { sword, type WeaponSprite } from './sprites';

// A Weapon stat block (ADR 0024): an equipped Weapon contributes damage + visuals ONLY.
// Phase durations, reach, Poise, and Knockback all come from the shared COMBAT constants,
// so a weapon can never change playstyle. The WEAPONS index is the wire-replicated
// appearance id.
export interface Weapon {
	name: string;
	damage: number; // HP per landed hit — the one combat stat a weapon contributes
	// A WeaponSprite composited onto the Avatar at the grip every frame (ADR 0018).
	// Optional while art is authored — an absent sprite draws no weapon layer.
	sprite?: WeaponSprite;
}

// The catalog: the one sword-and-shield kit (ADR 0024). Index 0 deals the shared COMBAT
// damage, so an Avatar with no weapon plays as before weapons existed.
export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		damage: COMBAT.meleeDamage,
		sprite: sword,
	},
];

export const DEFAULT_WEAPON = 0;

// Clamp-to-default lookup: an absent, out-of-range, or forward-version index falls back to
// the default sword rather than crashing combat or the renderer.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
