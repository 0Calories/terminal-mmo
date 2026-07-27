import { expect, test } from 'bun:test';
import { contractHash, spriteIdSets } from '../../src/release';

const BASE = {
	'packages/core/src/zones/zone.ts': 'export const step = 1;',
	'zones/field-01.zone': 'field geometry',
	'sprites/hats/wizard.sprite': 'wizard art v1',
	'sprites/forms/buddy.sprite': 'buddy art v1',
	'packages/client/src/index.ts': 'render loop',
	'docs/adr/0001-world-topology-and-authority.md': 'prose',
};

test('deterministic and insensitive to entry order', () => {
	const reversed = Object.fromEntries(Object.entries(BASE).reverse());
	expect(contractHash(BASE)).toBe(contractHash(BASE));
	expect(contractHash(reversed)).toBe(contractHash(BASE));
});

test('zone edit changes the hash', () => {
	const edited = { ...BASE, 'zones/field-01.zone': 'moved a platform' };
	expect(contractHash(edited)).not.toBe(contractHash(BASE));
});

test('core source edit changes the hash', () => {
	const edited = {
		...BASE,
		'packages/core/src/zones/zone.ts': 'export const step = 2;',
	};
	expect(contractHash(edited)).not.toBe(contractHash(BASE));
});

test('sprite art edit does not change the hash', () => {
	const edited = { ...BASE, 'sprites/hats/wizard.sprite': 'wizard art v2' };
	expect(contractHash(edited)).toBe(contractHash(BASE));
});

test('client-only code edit does not change the hash', () => {
	const edited = { ...BASE, 'packages/client/src/index.ts': 'new particles' };
	expect(contractHash(edited)).toBe(contractHash(BASE));
});

test('neither-classified edit does not change the hash', () => {
	const edited = {
		...BASE,
		'docs/adr/0001-world-topology-and-authority.md': 'rewritten',
	};
	expect(contractHash(edited)).toBe(contractHash(BASE));
});

test('adding a sprite id changes the hash', () => {
	const added = { ...BASE, 'sprites/hats/beret.sprite': 'beret art' };
	expect(contractHash(added)).not.toBe(contractHash(BASE));
});

test('renaming a sprite id changes the hash', () => {
	const { 'sprites/hats/wizard.sprite': art, ...rest } = BASE;
	const renamed = { ...rest, 'sprites/hats/sorcerer.sprite': art };
	expect(contractHash(renamed)).not.toBe(contractHash(BASE));
});

test('unknown paths hash as contract', () => {
	const withUnknown = { ...BASE, 'stray-file.txt': 'v1' };
	expect(contractHash(withUnknown)).not.toBe(contractHash(BASE));
	expect(contractHash({ ...BASE, 'stray-file.txt': 'v2' })).not.toBe(
		contractHash(withUnknown),
	);
});

test('spriteIdSets groups sorted ids per role tree', () => {
	const sets = spriteIdSets({
		'sprites/hats/wizard.sprite': 'a',
		'sprites/hats/cap.sprite': 'b',
		'sprites/forms/buddy.sprite': 'c',
		'zones/field-01.zone': 'not a sprite',
	});
	expect([...sets.keys()]).toEqual(['forms', 'hats']);
	expect(sets.get('hats')).toEqual(['cap', 'wizard']);
	expect(sets.get('forms')).toEqual(['buddy']);
});
