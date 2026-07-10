// Hat art registry (ADR 0031): hats live as `.sprite` files under
// repo-root `sprites/hats/`, discovered by `loadSpriteSources` and compiled
// here. A hat is pickable because its file exists on disk — there is no
// hand-authored TS art or catalog of hat definitions any more. 'None' is the
// absence of an id (`cosmetics.hat === ''`).

import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import type { Sprite } from './sprite';
import { spriteFromDoc } from './sprite-compile';
import { parseSpriteFile } from './sprite-file';

export function buildHatRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, Sprite> {
	const registry = new Map<string, Sprite>();
	for (const source of sources) {
		if (source.role !== 'hats') continue;
		const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
		if (doc === null) continue;
		if (diagnostics.some((d) => d.severity === 'error')) continue;
		registry.set(source.id, spriteFromDoc(doc));
	}
	return registry;
}

const registry = buildHatRegistry(loadSpriteSources().values());

export const HAT_IDS: readonly string[] = [...registry.keys()].sort();

export function hatById(id: string): Sprite | null {
	return registry.get(id) ?? null;
}
