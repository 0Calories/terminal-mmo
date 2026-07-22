import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpriteSource } from '@mmo/assets';
import { DEFAULT_FORM_ID } from '@mmo/core/entities';
import { buildFormRegistry, FORM_IDS, formById } from '../src';

const BUDDY_TEXT = readFileSync(
	join(import.meta.dir, '../../../sprites/forms/buddy.sprite'),
	'utf8',
);

function buddySource(id = 'buddy'): SpriteSource {
	return { id, role: 'forms', text: BUDDY_TEXT };
}

const MINIMAL = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "walk" }]
}
--- idle
AB
CD
--- walk 0
AB
CD
--- walk 1
AB
CD
`;

test('the real buddy.sprite compiles to a body with its full animation repertoire', () => {
	const registry = buildFormRegistry([buddySource()]);
	const body = registry.get('buddy');
	expect(body).toBeDefined();
	const animations = Object.keys(body?.frames ?? {}).sort();
	expect(animations).toEqual([
		'emote:dance',
		'emote:sit',
		'emote:wave',
		'idle',
		'jump',
		'walk',
	]);

	expect(Array.isArray(body?.frames['emote:wave'])).toBe(true);
	expect(Array.isArray(body?.frames['emote:dance'])).toBe(true);
	expect(Array.isArray(body?.frames.idle)).toBe(false);
});

test('a source outside the forms role is ignored', () => {
	const registry = buildFormRegistry([{ ...buddySource(), role: 'hats' }]);
	expect(registry.size).toBe(0);
});

test('a source with a broken header is skipped; the others still load', () => {
	const registry = buildFormRegistry([
		buddySource(),
		{ id: 'broken', role: 'forms', text: 'not valid json {{{' },
		{ id: 'mini', role: 'forms', text: MINIMAL },
	]);
	expect(registry.has('broken')).toBe(false);
	expect(registry.has('buddy')).toBe(true);
	expect(registry.has('mini')).toBe(true);
});

test('a source that fails the forms role profile is skipped', () => {
	const bad = `{ "anchors": { "grip": [0, 0] }, "animations": [{ "name": "idle" }] }
--- idle
AB
`;
	const registry = buildFormRegistry([
		buddySource(),
		{ id: 'bad', role: 'forms', text: bad },
	]);
	expect(registry.has('bad')).toBe(false);
	expect(registry.has('buddy')).toBe(true);
});

test('a source authoring an unregistered emote animation is skipped (role error)', () => {
	const withBadEmote = `{
	"anchors": { "grip": [0, 0], "head": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "walk" }, { "name": "emote:boogie" }]
}
--- idle
AB
--- walk 0
AB
--- walk 1
AB
--- emote:boogie
AB
`;
	const registry = buildFormRegistry([
		{ id: 'boogie', role: 'forms', text: withBadEmote },
	]);
	expect(registry.has('boogie')).toBe(false);
});

test('FORM_IDS is sorted and the module registry resolves the default Form', () => {
	expect([...FORM_IDS]).toEqual([...FORM_IDS].sort());
	expect(FORM_IDS).toContain(DEFAULT_FORM_ID);

	const dflt = formById(DEFAULT_FORM_ID);
	expect(formById('does-not-exist')).toBe(dflt);
	expect(formById(undefined)).toBe(dflt);
});
