// Weapon art registry (ADR 0031): weapons live as `.sprite` files under
// repo-root `sprites/weapons/`, discovered by `loadSpriteSources` and compiled
// here — the forms.ts/hats.ts pattern applied to weapon art. Weapon *stats*
// (name, damage) stay in the `@mmo/core` WEAPONS catalog; each catalog entry
// references its art by `sprite` id. There is no hand-authored TS weapon art
// any more. A dangling/unknown sprite id (or an out-of-range catalog index)
// resolves to `undefined`, so the renderer safely draws no weapon.

import { weaponById } from '@mmo/core';
import { compileWeaponSprite } from './sprite-compile';
import { parseSpriteFile } from './sprite-file';
import { loadSpriteSources, type SpriteSource } from './sprite-sources';
import { validateSpriteRole } from './sprite-validate';
import type { WeaponSprite } from './weapon-sprite';

export function buildWeaponRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, WeaponSprite> {
	const registry = new Map<string, WeaponSprite>();
	for (const source of sources) {
		if (source.role !== 'weapons') continue;
		const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
		if (doc === null) continue;
		if (diagnostics.some((d) => d.severity === 'error')) continue;
		// A weapon that does not satisfy the role profile (missing phase poses or
		// the grip anchor) is skipped rather than compiled into broken art.
		if (validateSpriteRole(doc, 'weapons').some((d) => d.severity === 'error'))
			continue;
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
