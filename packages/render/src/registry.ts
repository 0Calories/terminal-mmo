import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import { DEFAULT_FORM_ID, type EntityType, type Npc } from '@mmo/core/entities';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import { formFrame } from './body-sprite';
import { formById } from './forms';
import { Sprite } from './sprite';
import { spriteFromDoc } from './sprite-compile';
import { acceptSprite } from './sprite-validate';

const PLACEHOLDER_SPRITE = new Sprite('·', { defaultKey: 'p' });

export function buildSpriteRegistry(
	sources: Iterable<SpriteSource>,
	role: string,
): ReadonlyMap<string, Sprite> {
	const registry = new Map<string, Sprite>();
	for (const source of sources) {
		if (source.role !== role) continue;
		const doc = acceptSprite(source, role);
		if (doc === null) continue;
		registry.set(source.id, spriteFromDoc(doc, 'idle'));
	}
	return registry;
}

export function buildMonsterRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, Sprite> {
	return buildSpriteRegistry(sources, 'monsters');
}

export function buildNpcRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, Sprite> {
	return buildSpriteRegistry(sources, 'npcs');
}

const monsterRegistry = buildMonsterRegistry(loadSpriteSources().values());
const npcRegistry = buildNpcRegistry(loadSpriteSources().values());

export const MONSTER_SPRITE_IDS: readonly string[] = [
	...monsterRegistry.keys(),
].sort();
export const NPC_SPRITE_IDS: readonly string[] = [...npcRegistry.keys()].sort();

export function spriteFor(type: EntityType): Sprite {
	if (type === 'player') return formFrame(formById(DEFAULT_FORM_ID), 'idle');
	return monsterRegistry.get(MONSTER_SPRITE_REF[type]) ?? PLACEHOLDER_SPRITE;
}

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return npcRegistry.get(NPC_SPRITE_REF[kind]) ?? PLACEHOLDER_SPRITE;
}
