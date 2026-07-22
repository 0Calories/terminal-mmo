import type { Npc } from '../entities/npc';
import type { EntityType } from '../entities/types';

export interface SpriteMeta {
	defaultKey: string;

	baseline: number;
}

const ENTITY_SPRITE_META: Record<EntityType, SpriteMeta> = {
	player: { defaultKey: 'p', baseline: 0 },
	chaser: { defaultKey: 'm', baseline: 0 },
	shooter: { defaultKey: 'o', baseline: 0 },
	brute: { defaultKey: 's', baseline: 0 },
};

export function spriteMetaFor(type: EntityType): SpriteMeta {
	return ENTITY_SPRITE_META[type];
}

export const MONSTER_SPRITE_REF: Readonly<
	Record<Exclude<EntityType, 'player'>, string>
> = {
	chaser: 'chaser',
	shooter: 'shooter',
	brute: 'brute',
};

export const NPC_SPRITE_REF: Readonly<Record<Npc['kind'], string>> = {
	vendor: 'merchant',
};

export function monsterSpriteRef(type: EntityType): string | undefined {
	return type === 'player' ? undefined : MONSTER_SPRITE_REF[type];
}

export function npcSpriteRef(kind: Npc['kind']): string {
	return NPC_SPRITE_REF[kind];
}
