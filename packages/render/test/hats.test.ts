// Unit tests for the hat art registry (ADR 0031): pure compilation from
// SpriteSource entries, independent of the module-level disk scan.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpriteSource } from '@mmo/assets';
import { buildHatRegistry, HAT_IDS, hatById } from '../src/hats';

const SPRITES_DIR = join(import.meta.dir, '../../../sprites/hats');

const REAL_FILES = ['cap', 'crown', 'wizard', 'top-hat', 'party-hat'] as const;

function realSource(id: string): SpriteSource {
	const text = readFileSync(join(SPRITES_DIR, `${id}.sprite`), 'utf8');
	return { id, role: 'hats', text };
}

test('five real hat sources compile to five ids, sorted', () => {
	const registry = buildHatRegistry(REAL_FILES.map(realSource));
	expect([...registry.keys()].sort()).toEqual([
		'cap',
		'crown',
		'party-hat',
		'top-hat',
		'wizard',
	]);
});

test('a source with a broken header is skipped; the others still load', () => {
	const sources: SpriteSource[] = [
		...REAL_FILES.map(realSource),
		{ id: 'broken', role: 'hats', text: 'not valid json {{{' },
	];
	const registry = buildHatRegistry(sources);
	expect(registry.has('broken')).toBe(false);
	expect(registry.size).toBe(5);
});

test('a source outside the hats role is ignored', () => {
	const registry = buildHatRegistry([
		{ id: 'buddy', role: 'forms', text: realSource('cap').text },
	]);
	expect(registry.size).toBe(0);
});

test('the module-level HAT_IDS matches the five known ids sorted', () => {
	expect(HAT_IDS).toEqual(['cap', 'crown', 'party-hat', 'top-hat', 'wizard']);
});

test("hatById('') and hatById('nope') are null", () => {
	expect(hatById('')).toBeNull();
	expect(hatById('nope')).toBeNull();
});
