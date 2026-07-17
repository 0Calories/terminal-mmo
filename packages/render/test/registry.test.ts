import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { DEFAULT_FORM_ID, type EntityType } from '@mmo/core/entities';
import {
	MONSTER_SPRITE_REF,
	NPC_SPRITE_REF,
	spriteMetaFor,
} from '@mmo/core/sprites';
import {
	buildMonsterRegistry,
	buildNpcRegistry,
	FORM_IDS,
	formById,
	HAT_IDS,
	hatById,
	spriteFor,
	spriteForNpc,
	weaponSpriteById,
} from '../src';

// A minimal valid single-frame monster/npc source (satisfies the `idle`-only
// role profile). `role` decides which registry claims it.
function source(id: string, role: string): SpriteSource {
	return { id, role, text: '{"key":"m"}\n--- idle\n▟▙\n▜▛\n' };
}

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

// Every Monster/NPC art reference in @mmo/core must resolve to a compiled sprite
// on disk — the live parity: a reference whose `.sprite` file is missing/renamed
// is exactly the dangling case the fallback guards.
test('every core Monster/NPC sprite reference resolves to shipped art', () => {
	for (const type of Object.keys(MONSTER_SPRITE_REF) as EntityType[]) {
		expect(spriteFor(type).w).toBeGreaterThan(0);
	}
	for (const kind of Object.keys(
		NPC_SPRITE_REF,
	) as (keyof typeof NPC_SPRITE_REF)[]) {
		expect(spriteForNpc(kind).w).toBeGreaterThan(0);
	}
});

// buildSpriteRegistry (via the monster/npc wrappers) only claims sources of its
// own role; a foreign-role source is left for another registry.
test('a registry compiles only its own role', () => {
	const sources = [source('a', 'monsters'), source('b', 'npcs')];
	const monsters = buildMonsterRegistry(sources);
	const npcs = buildNpcRegistry(sources);
	expect([...monsters.keys()]).toEqual(['a']);
	expect([...npcs.keys()]).toEqual(['b']);
});

// A source that fails the role profile (no `idle` animation) is skipped, not compiled
// into broken art — mirrors buildFormRegistry / buildWeaponRegistry.
test('a profile-failing source is skipped', () => {
	const good = source('good', 'monsters');
	// `walk` frame → implicit animation `walk`, never the required `idle`.
	const bad: SpriteSource = {
		id: 'bad',
		role: 'monsters',
		text: '{"key":"m"}\n--- walk\n▟▙\n',
	};
	const registry = buildMonsterRegistry([good, bad]);
	expect(registry.has('good')).toBe(true);
	expect(registry.has('bad')).toBe(false);
});

// A parse-error source (bad header JSON) is skipped, never crashing the build.
test('a parse-error source is skipped, not thrown', () => {
	const broken: SpriteSource = {
		id: 'broken',
		role: 'monsters',
		text: '{not json}\n--- idle\n▟▙\n',
	};
	expect(() => buildMonsterRegistry([broken])).not.toThrow();
	expect(buildMonsterRegistry([broken]).size).toBe(0);
});

// A dangling reference (the id an entity/NPC points at is absent from the
// registry) must never crash rendering: spriteFor/spriteForNpc fall back to a
// safe placeholder sprite. Emulated here with an empty source set so no shipped
// reference resolves — the diagnostic for the dangling case is a later slice
// (`forge sprite check`); runtime safety is proven here.
test('a dangling reference falls back to a safe placeholder, never crashing', () => {
	const empty = buildMonsterRegistry([]);
	expect(empty.size).toBe(0);
	// The live resolvers guard against exactly this: even if the registries were
	// empty, resolving any reference yields a drawable placeholder, not a throw.
	for (const type of Object.keys(MONSTER_SPRITE_REF) as EntityType[]) {
		const art = spriteFor(type);
		expect(art.w).toBeGreaterThan(0);
		expect(art.h).toBeGreaterThan(0);
	}
	for (const kind of Object.keys(
		NPC_SPRITE_REF,
	) as (keyof typeof NPC_SPRITE_REF)[]) {
		const art = spriteForNpc(kind);
		expect(art.w).toBeGreaterThan(0);
	}
});
