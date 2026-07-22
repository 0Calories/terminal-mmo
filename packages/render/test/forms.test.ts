import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import { DEFAULT_FORM_ID } from '@mmo/core/entities';
import { buildFormRegistry, FORM_IDS, formById } from '../src';

function formSource(id = 'form'): SpriteSource {
	return { id, role: 'forms', text: MINIMAL };
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

test('a valid Form source compiles its required Animations and anchors', () => {
	const registry = buildFormRegistry([formSource()]);
	const body = registry.get('form');
	expect(body).toBeDefined();
	expect(body?.grip).toEqual({ x: 1, y: 0 });
	expect(body?.head).toEqual({ x: 0, y: 0 });
	expect(Array.isArray(body?.frames.idle)).toBe(false);
	expect(Array.isArray(body?.frames.walk)).toBe(true);
});

test('a source outside the forms role is ignored', () => {
	const registry = buildFormRegistry([{ ...formSource(), role: 'hats' }]);
	expect(registry.size).toBe(0);
});

test('a source with a broken header is skipped; the others still load', () => {
	const registry = buildFormRegistry([
		formSource(),
		{ id: 'broken', role: 'forms', text: 'not valid json {{{' },
		{ id: 'mini', role: 'forms', text: MINIMAL },
	]);
	expect(registry.has('broken')).toBe(false);
	expect(registry.has('form')).toBe(true);
	expect(registry.has('mini')).toBe(true);
});

test('a source that fails the forms role profile is skipped', () => {
	const bad = `{ "anchors": { "grip": [0, 0] }, "animations": [{ "name": "idle" }] }
--- idle
AB
`;
	const registry = buildFormRegistry([
		formSource(),
		{ id: 'bad', role: 'forms', text: bad },
	]);
	expect(registry.has('bad')).toBe(false);
	expect(registry.has('form')).toBe(true);
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
