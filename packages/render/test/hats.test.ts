import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import { buildHatRegistry, HAT_IDS, hatById } from '../src/hats';

const HAT = `{ "animations": [{ "name": "idle" }] }
--- idle
▲
`;

function source(id: string, role = 'hats'): SpriteSource {
	return { id, role, text: HAT };
}

test('hat sources compile into a registry independent of module ids', () => {
	const registry = buildHatRegistry([source('zeta'), source('alpha')]);
	expect(new Set(registry.keys())).toEqual(new Set(['alpha', 'zeta']));
});

test('a source with a broken header is skipped; the others still load', () => {
	const sources: SpriteSource[] = [
		source('valid'),
		{ id: 'broken', role: 'hats', text: 'not valid json {{{' },
	];
	const registry = buildHatRegistry(sources);
	expect(registry.has('broken')).toBe(false);
	expect(registry.has('valid')).toBe(true);
});

test('a source outside the hats role is ignored', () => {
	const registry = buildHatRegistry([source('body', 'forms')]);
	expect(registry.size).toBe(0);
});

test('the module hat registry is sorted and every id resolves', () => {
	expect(HAT_IDS).toEqual([...HAT_IDS].sort());
	for (const id of HAT_IDS) expect(hatById(id)).not.toBeNull();
});

test("hatById('') and hatById('nope') are null", () => {
	expect(hatById('')).toBeNull();
	expect(hatById('nope')).toBeNull();
});
