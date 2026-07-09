import { expect, test } from 'bun:test';
import {
	type EntityType,
	FORM_COUNT,
	HAT_COUNT,
	spriteMetaFor,
	WEAPONS,
} from '@mmo/core';
import { FORMS, HATS, spriteFor, weaponSpriteById } from '../src';

// The @mmo/core registry counts are the metadata source of truth; the art registries
// here must stay index-aligned with them (a stray art entry can't drift the count the
// server-side cosmetics validation clamps against).
test('the Form art registry matches the @mmo/core FORM_COUNT', () => {
	expect(FORMS.length).toBe(FORM_COUNT);
});

test('the hat art registry matches the @mmo/core HAT_COUNT', () => {
	expect(HATS.length).toBe(HAT_COUNT);
});

test('the default hat (slot 0) is bareheaded; every other hat has art', () => {
	expect(HATS[0].sprite).toBeNull();
	for (let i = 1; i < HATS.length; i++) expect(HATS[i].sprite).not.toBeNull();
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
