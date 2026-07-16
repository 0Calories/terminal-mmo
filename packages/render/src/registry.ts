// Monster & NPC art registry (ADR 0031): the art each entity type / NPC kind
// draws lives as a `.sprite` file under `sprites/monsters/` or `sprites/npcs/`,
// discovered by `loadSpriteSources` and compiled here — the forms.ts /
// weapon-registry.ts pattern applied to Monster and NPC art. There is no
// hand-authored TS Monster/NPC art any more: the entity-type→art binding is a
// sprite-id *reference* owned by @mmo/core (`MONSTER_SPRITE_REF` / `NPC_SPRITE_REF`),
// resolved against these registries. A dangling/unknown reference (an id with no
// compiled sprite) falls back to a placeholder guard so rendering never crashes;
// a diagnostic for such a dangling reference is `forge sprite check`'s job.

import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import { DEFAULT_FORM_ID, type EntityType, type Npc } from '@mmo/core/entities';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import { formFrame } from './body-sprite';
import { formById } from './forms';
import { Sprite } from './sprite';
import { spriteFromDoc } from './sprite-compile';
import { acceptSprite } from './sprite-validate';

// A guard sprite used only when a reference is dangling (its id has no compiled
// sprite in the registry) — a broken/renamed art file or a bare test env with no
// `sprites/` tree. It is not art: one transparent cell keeps the renderer from
// crashing on a missing sprite (mirrors forms.ts's PLACEHOLDER_BODY).
const PLACEHOLDER_SPRITE = new Sprite('·', { defaultKey: 'p' });

// Compile every `.sprite` source of the given role into a single-frame Sprite,
// keyed by id. Skips parse-error and role-profile failures rather than compiling
// broken art — identical filtering to buildFormRegistry / buildWeaponRegistry.
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

// A player entity never renders through the Monster registry — it routes through
// the Form registry (formById), the same body a real player draws, so the two can
// never drift. Every other EntityType resolves its art through the @mmo/core
// sprite-id reference; a dangling reference falls back to the placeholder guard.
export function spriteFor(type: EntityType): Sprite {
	if (type === 'player') return formFrame(formById(DEFAULT_FORM_ID), 'idle');
	return monsterRegistry.get(MONSTER_SPRITE_REF[type]) ?? PLACEHOLDER_SPRITE;
}

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return npcRegistry.get(NPC_SPRITE_REF[kind]) ?? PLACEHOLDER_SPRITE;
}
