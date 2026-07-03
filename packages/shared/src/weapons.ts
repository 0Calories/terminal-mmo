import { COMBAT } from './constants';
import { sword, type WeaponSprite } from './sprites';

// A Weapon stat block (ADR 0024): the data an equipped Weapon Item contributes —
// damage plus visuals (its WeaponSprite and that sprite's accent colour) ONLY.
// Every weapon swings the one sword-and-shield moveset with the one shared
// animation set: phase durations, arc (reach), Poise damage and Knockback all come
// from the shared COMBAT constants, so a weapon can never change playstyle — loot
// variety is stats and looks (rarity/affixes ride the rolled Item, not this block).
// Indexed in WEAPONS; the index is the wire-replicated appearance id, so a weapon
// is fully described by one small int.
export interface Weapon {
	name: string;
	damage: number; // HP per landed hit — the one combat stat a weapon contributes
	// The always-anchored animated appearance (ADR 0018): a WeaponSprite composited
	// onto the Avatar at the grip every frame, carrying the weapon's single accent
	// colour. Optional while art is authored — an absent sprite draws no weapon layer.
	sprite?: WeaponSprite;
}

// The catalog: the one sword-and-shield kit (ADR 0024 — the dagger/greatsword
// archetypes are deferred out of the demo). Index 0 deals the shared COMBAT damage,
// so an Avatar with no weapon plays exactly as before weapons existed.
export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		damage: COMBAT.meleeDamage,
		sprite: sword,
	},
];

export const DEFAULT_WEAPON = 0;

// Clamp-to-default lookup (mirrors clampCosmetics): an absent, out-of-range, or
// forward-version index can never crash combat or the renderer — it falls back to
// the default sword.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}
