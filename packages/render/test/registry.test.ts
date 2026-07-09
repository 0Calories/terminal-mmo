import { expect, test } from 'bun:test';
import { type EntityType, FORM_COUNT, spriteMetaFor, WEAPONS } from '@mmo/core';
import { FORMS, HAT_IDS, hatById, spriteFor, weaponSpriteById } from '../src';

// The @mmo/core registry counts are the metadata source of truth; the art registries
// here must stay index-aligned with them (a stray art entry can't drift the count the
// server-side cosmetics validation clamps against).
test('the Form art registry matches the @mmo/core FORM_COUNT', () => {
	expect(FORMS.length).toBe(FORM_COUNT);
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
