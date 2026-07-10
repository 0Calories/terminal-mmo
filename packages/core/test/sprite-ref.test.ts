// Pins the Monster/NPC art-reference crumbs (ADR 0031) and proves the
// server-visible sprite metadata (the death-tint `defaultKey`) stays core-owned.
// Everything here imports from @mmo/core ONLY: the deterministic sim / server
// reads its identity crumbs from core, never from @mmo/render's art.
import { expect, test } from 'bun:test';
import {
	type Entity,
	entityTint,
	MONSTER_SPRITE_REF,
	monsterSpriteRef,
	NPC_SPRITE_REF,
	npcSpriteRef,
	SCENE_PALETTE,
	spriteMetaFor,
} from '../src';

// The five art references this migration introduces — the ids that key the
// `.sprite` files under sprites/monsters/ and sprites/npcs/ (chaser, shooter,
// brute, merchant, signpost). Behaviour/stats stay elsewhere; these are art
// bindings only.
test('the Monster/NPC sprite references are the five migrated ids', () => {
	expect(MONSTER_SPRITE_REF).toEqual({
		chaser: 'chaser',
		shooter: 'shooter',
		brute: 'brute',
	});
	expect(NPC_SPRITE_REF).toEqual({
		vendor: 'merchant',
		signpost: 'signpost',
	});
});

test('the reference resolvers return the crumb id (player has no Monster art)', () => {
	expect(monsterSpriteRef('chaser')).toBe('chaser');
	expect(monsterSpriteRef('shooter')).toBe('shooter');
	expect(monsterSpriteRef('brute')).toBe('brute');
	expect(monsterSpriteRef('player')).toBeUndefined();
	expect(npcSpriteRef('vendor')).toBe('merchant');
	expect(npcSpriteRef('signpost')).toBe('signpost');
});

// The death-tint crumb the server reads is `spriteMetaFor(type).defaultKey`, a
// palette key resolved to an RGB in core (BODY_PALETTE === SCENE_PALETTE). This
// data must NOT come from @mmo/render — this file, importing core alone, computes
// the full death tint, proving the server never needs the art package.
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
		// entityTint (authoritative combat's death tint) === the core palette
		// colour of the core-owned defaultKey crumb.
		expect(entityTint(monster(type))).toEqual({ r, g, b });
	}
});
