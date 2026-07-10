import { expect, test } from 'bun:test';
import {
	DEFAULT_FORM_ID,
	type EntityType,
	spriteMetaFor,
	WEAPONS,
} from '@mmo/core';
import {
	FORM_IDS,
	formById,
	HAT_IDS,
	hatById,
	spriteFor,
	weaponSpriteById,
} from '../src';

// Forms are discovered by directory scan (ADR 0031). The catalog is whatever
// `.sprite` files ship under sprites/forms/; the launch demo ships exactly one,
// 'buddy', which must always be resolvable as the default Form.
test('FORM_IDS contains the shipped default Form, which resolves to a body', () => {
	expect(FORM_IDS).toContain(DEFAULT_FORM_ID);
	expect(formById(DEFAULT_FORM_ID).frames.idle).toBeDefined();
});

// Hats are discovered by directory scan (ADR 0031) — the five known
// `.sprite` files under sprites/hats/ are the whole catalog.
test('HAT_IDS is the five known hats, sorted lexicographically', () => {
	expect(HAT_IDS).toEqual(['cap', 'crown', 'party-hat', 'top-hat', 'wizard']);
});

test('every hat id resolves to art; an unknown/empty id is bareheaded', () => {
	for (const id of HAT_IDS) expect(hatById(id)).not.toBeNull();
	expect(hatById('')).toBeNull();
	expect(hatById('nope')).toBeNull();
});

// entityTint (authoritative combat's death tint) resolves each entity's default
// palette key from core's ENTITY_SPRITE_META, while the body paints with the art
// grid's own defaultKey. If an artist retunes a sprite render-side without touching
// core, the corpse would tint the old colour — this guard makes that drift a failure.
test("every entity's art defaultKey/baseline matches the @mmo/core sprite metadata", () => {
	const types: readonly EntityType[] = ['player', 'chaser', 'shooter', 'brute'];
	for (const type of types) {
		const art = spriteFor(type);
		const meta = spriteMetaFor(type);
		expect(art.defaultKey).toBe(meta.defaultKey);
		expect(art.baseline).toBe(meta.baseline);
	}
});

test('every WEAPONS catalog id resolves to weapon art with an accent colour', () => {
	for (let i = 0; i < WEAPONS.length; i++) {
		const sprite = weaponSpriteById(i);
		expect(sprite).toBeDefined();
		expect(typeof sprite?.accent).toBe('string');
	}
});
