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

test('the Monster/NPC sprite references are the migrated ids', () => {
	expect(MONSTER_SPRITE_REF).toEqual({
		chaser: 'chaser',
		shooter: 'shooter',
		brute: 'brute',
	});
	expect(NPC_SPRITE_REF).toEqual({
		vendor: 'merchant',
	});
});

test('the reference resolvers return the crumb id (player has no Monster art)', () => {
	expect(monsterSpriteRef('chaser')).toBe('chaser');
	expect(monsterSpriteRef('shooter')).toBe('shooter');
	expect(monsterSpriteRef('brute')).toBe('brute');
	expect(monsterSpriteRef('player')).toBeUndefined();
	expect(npcSpriteRef('vendor')).toBe('merchant');
});

test('the death-tint crumb (defaultKey) is core-owned, not render-owned', () => {
	const monster = (type: Entity['type']): Entity => ({
		id: 1,
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
		type,
	});
	for (const type of ['chaser', 'shooter', 'brute'] as const) {
		const key = spriteMetaFor(type).defaultKey;
		const [r, g, b] = SCENE_PALETTE[key as keyof typeof SCENE_PALETTE];

		expect(entityTint(monster(type))).toEqual({ r, g, b });
	}
});
