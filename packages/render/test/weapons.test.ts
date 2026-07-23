import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import { DEFAULT_WEAPON, WEAPONS } from '@mmo/core/combat';
import {
	buildWeaponRegistry,
	WEAPON_SPRITE_IDS,
	weaponSpriteById,
} from '../src';

const MINIMAL = `{ "accent": "s", "anchors": { "grip": [0, 0] }, "animations": [{ "name": "idle" }, { "name": "swing" }] }
--- idle
AB
--- swing 0
AB
--- swing 1
AB
--- swing 2
AB
`;

function weaponSource(id = 'weapon'): SpriteSource {
	return { id, role: 'weapons', text: MINIMAL };
}

test('a valid weapon source compiles its phase frames, accent, and grip', () => {
	const registry = buildWeaponRegistry([weaponSource()]);
	const ws = registry.get('weapon');
	expect(ws).toBeDefined();
	expect(ws?.frames.rest).toBeDefined();
	expect(ws?.frames.swing).toHaveLength(3);
	expect(ws?.accent).toBe('s');

	expect(ws?.grip).toEqual({ x: 0, y: 0 });
});

test('a source outside the weapons role is ignored', () => {
	const registry = buildWeaponRegistry([{ ...weaponSource(), role: 'hats' }]);
	expect(registry.size).toBe(0);
});

test('a source with a broken header is skipped; the others still load', () => {
	const registry = buildWeaponRegistry([
		weaponSource(),
		{ id: 'broken', role: 'weapons', text: 'not valid json {{{' },
		{ id: 'mini', role: 'weapons', text: MINIMAL },
	]);
	expect(registry.has('broken')).toBe(false);
	expect(registry.has('weapon')).toBe(true);
	expect(registry.has('mini')).toBe(true);
});

test('a source that fails the weapons role profile is skipped', () => {
	const bad = `{ "animations": [{ "name": "idle" }, { "name": "windup" }] }
--- idle
AB
--- windup
AB
`;
	const registry = buildWeaponRegistry([
		weaponSource(),
		{ id: 'bad', role: 'weapons', text: bad },
	]);
	expect(registry.has('bad')).toBe(false);
	expect(registry.has('weapon')).toBe(true);
});

test('a dangling sprite id resolves to undefined (registry miss)', () => {
	const registry = buildWeaponRegistry([weaponSource()]);
	expect(registry.get('does-not-exist')).toBeUndefined();
});

test('WEAPON_SPRITE_IDS is sorted and every catalog entry resolves to art', () => {
	expect([...WEAPON_SPRITE_IDS]).toEqual([...WEAPON_SPRITE_IDS].sort());
	for (let i = 0; i < WEAPONS.length; i++) {
		const ws = weaponSpriteById(i);
		expect(ws).toBeDefined();
		expect(typeof ws?.accent).toBe('string');
	}

	expect(weaponSpriteById(9999)).toBe(weaponSpriteById(DEFAULT_WEAPON));
	expect(weaponSpriteById(undefined)).toBe(weaponSpriteById(DEFAULT_WEAPON));
});
