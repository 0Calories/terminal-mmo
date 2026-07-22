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

function source(id: string, role: string): SpriteSource {
	return {
		id,
		role,
		text: '{"key":"m","animations":[{"name":"idle"}]}\n--- idle\n▟▙\n▜▛\n',
	};
}

test('FORM_IDS contains the shipped default Form, which resolves to a body', () => {
	expect(FORM_IDS).toContain(DEFAULT_FORM_ID);
	expect(formById(DEFAULT_FORM_ID).frames.idle).toBeDefined();
});

test('HAT_IDS is the five known hats, sorted lexicographically', () => {
	expect(HAT_IDS).toEqual(['cap', 'crown', 'party-hat', 'top-hat', 'wizard']);
});

test('every hat id resolves to art; an unknown/empty id is bareheaded', () => {
	for (const id of HAT_IDS) expect(hatById(id)).not.toBeNull();
	expect(hatById('')).toBeNull();
	expect(hatById('nope')).toBeNull();
});

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

test('a registry compiles only its own role', () => {
	const sources = [source('a', 'monsters'), source('b', 'npcs')];
	const monsters = buildMonsterRegistry(sources);
	const npcs = buildNpcRegistry(sources);
	expect([...monsters.keys()]).toEqual(['a']);
	expect([...npcs.keys()]).toEqual(['b']);
});

test('a profile-failing source is skipped', () => {
	const good = source('good', 'monsters');

	const bad: SpriteSource = {
		id: 'bad',
		role: 'monsters',
		text: '{"key":"m","animations":[{"name":"walk"}]}\n--- walk\n▟▙\n',
	};
	const registry = buildMonsterRegistry([good, bad]);
	expect(registry.has('good')).toBe(true);
	expect(registry.has('bad')).toBe(false);
});

test('a parse-error source is skipped, not thrown', () => {
	const broken: SpriteSource = {
		id: 'broken',
		role: 'monsters',
		text: '{not json}\n--- idle\n▟▙\n',
	};
	expect(() => buildMonsterRegistry([broken])).not.toThrow();
	expect(buildMonsterRegistry([broken]).size).toBe(0);
});

test('a dangling reference falls back to a safe placeholder, never crashing', () => {
	const empty = buildMonsterRegistry([]);
	expect(empty.size).toBe(0);

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
