import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import { DEFAULT_FORM_ID } from '@mmo/core/entities';
import type { BodySprite } from './body-sprite';
import { Sprite } from './sprite';
import { compileBodySprite } from './sprite-compile';
import { acceptSprite } from './sprite-validate';

const PLACEHOLDER_BODY: BodySprite = {
	frames: { idle: new Sprite('·', { defaultKey: 'p' }) },
	grip: { x: 0, y: 0 },
	head: { x: 0, y: 0 },
};

export function buildFormRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, BodySprite> {
	const registry = new Map<string, BodySprite>();
	for (const source of sources) {
		if (source.role !== 'forms') continue;

		const doc = acceptSprite(source, 'forms');
		if (doc === null) continue;
		registry.set(source.id, compileBodySprite(doc));
	}
	return registry;
}

const registry = buildFormRegistry(loadSpriteSources().values());

export const FORM_IDS: readonly string[] = [...registry.keys()].sort();

export function formById(id: string | undefined): BodySprite {
	return (
		(id !== undefined ? registry.get(id) : undefined) ??
		registry.get(DEFAULT_FORM_ID) ??
		PLACEHOLDER_BODY
	);
}
