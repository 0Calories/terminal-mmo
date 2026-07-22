import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import { weaponById } from '@mmo/core/combat';
import { compileWeaponSprite } from './sprite-compile';
import { acceptSprite } from './sprite-validate';
import type { WeaponSprite } from './weapon-sprite';

export function buildWeaponRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, WeaponSprite> {
	const registry = new Map<string, WeaponSprite>();
	for (const source of sources) {
		if (source.role !== 'weapons') continue;

		const doc = acceptSprite(source, 'weapons');
		if (doc === null) continue;
		registry.set(source.id, compileWeaponSprite(doc));
	}
	return registry;
}

const registry = buildWeaponRegistry(loadSpriteSources().values());

export const WEAPON_SPRITE_IDS: readonly string[] = [...registry.keys()].sort();

export function weaponSpriteById(
	i: number | undefined,
): WeaponSprite | undefined {
	return registry.get(weaponById(i).sprite);
}
