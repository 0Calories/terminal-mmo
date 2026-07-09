import { DEFAULT_WEAPON } from '@mmo/core';
import type { WeaponSprite } from './weapon-sprite';
import { sword } from './weapons/sword';

// Weapon *art* keyed to the @mmo/core WEAPONS catalog index (stats live core-side).
// Must stay index-aligned with WEAPONS (guarded by a render-side test).
const WEAPON_SPRITES: readonly (WeaponSprite | undefined)[] = [sword];

export function weaponSpriteById(
	i: number | undefined,
): WeaponSprite | undefined {
	if (i === undefined || i < 0 || i >= WEAPON_SPRITES.length)
		return WEAPON_SPRITES[DEFAULT_WEAPON];
	return WEAPON_SPRITES[i];
}
