// Weapon art registry (ADR 0031): weapons live as `.sprite` files under
// repo-root `sprites/weapons/`, discovered by `loadSpriteSources` and compiled
// here — the forms.ts/hats.ts pattern applied to weapon art. Weapon *stats*
// (name, damage) stay in the `@mmo/core` WEAPONS catalog; each catalog entry
// references its art by `sprite` id. There is no hand-authored TS weapon art
// any more. A dangling/unknown sprite id (or an out-of-range catalog index)
// resolves to `undefined`, so the renderer safely draws no weapon.

import { weaponById } from '@mmo/core';
import { compileWeaponSprite } from './sprite-compile';
import { loadSpriteSources, type SpriteSource } from './sprite-sources';
import { acceptSprite } from './sprite-validate';
import type { WeaponSprite } from './weapon-sprite';

export function buildWeaponRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, WeaponSprite> {
	const registry = new Map<string, WeaponSprite>();
	for (const source of sources) {
		if (source.role !== 'weapons') continue;
		// A weapon that fails to parse or does not satisfy the role profile (missing
		// phase poses or the grip anchor) is skipped rather than compiled into broken
		// art.
		const doc = acceptSprite(source, 'weapons');
		if (doc === null) continue;
		registry.set(source.id, compileWeaponSprite(doc));
	}
	return registry;
}

const registry = buildWeaponRegistry(loadSpriteSources().values());

export const WEAPON_SPRITE_IDS: readonly string[] = [...registry.keys()].sort();

// Resolve a wire-replicated weapon catalog index to its art. The index keys the
// `@mmo/core` WEAPONS catalog, whose entry carries the `sprite` id that keys this
// registry. An out-of-range index falls back to the default weapon (like the
// catalog itself); a dangling/unknown sprite id yields `undefined` so the
// renderer draws no weapon rather than crashing.
export function weaponSpriteById(
	i: number | undefined,
): WeaponSprite | undefined {
	return registry.get(weaponById(i).sprite);
}
