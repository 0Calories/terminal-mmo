import { expect, test } from 'bun:test';
import { entityTint } from '../../src/combat';
import { type Entity, SCENE_PALETTE } from '../../src/entities';
import {
	MONSTER_SPRITE_REF,
	monsterSpriteRef,
	NPC_SPRITE_REF,
	npcSpriteRef,
	spriteMetaFor,
} from '../../src/sprites';

test('Sprite reference resolvers agree with their configured semantic mappings', () => {
	for (const [type, spriteId] of Object.entries(MONSTER_SPRITE_REF))
		expect(monsterSpriteRef(type as keyof typeof MONSTER_SPRITE_REF)).toBe(
			spriteId,
		);
	expect(monsterSpriteRef('player')).toBeUndefined();
	for (const [kind, spriteId] of Object.entries(NPC_SPRITE_REF))
		expect(npcSpriteRef(kind as keyof typeof NPC_SPRITE_REF)).toBe(spriteId);
});

test('entity death tint is derived from core-owned Sprite metadata', () => {
	const monster = (type: Entity['type']): Entity => ({
		id: 1,
		type,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 1,
		maxHp: 1,
		hurtT: 0,
		attackT: 0,
	});
	for (const type of Object.keys(MONSTER_SPRITE_REF) as Array<
		keyof typeof MONSTER_SPRITE_REF
	>) {
		const key = spriteMetaFor(type).defaultKey;
		const [r, g, b] = SCENE_PALETTE[key as keyof typeof SCENE_PALETTE];
		expect(entityTint(monster(type))).toEqual({ r, g, b });
	}
});
