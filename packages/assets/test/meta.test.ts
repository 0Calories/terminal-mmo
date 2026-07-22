import { afterEach, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { loadZones, spriteIds } from '../src/meta';

let savedCwd: string | undefined;
afterEach(() => {
	if (savedCwd) {
		process.chdir(savedCwd);
		savedCwd = undefined;
	}
});

test('spriteIds over an injected embedded map: role members only, .sprite only', () => {
	const entries = {
		'sprites/hats/crown.sprite': 'x',
		'sprites/hats/cap.sprite': 'x',
		'sprites/hats/notes.txt': 'x',
		'sprites/forms/buddy.sprite': 'x',
		'zones/town-01.zone': 'x',
	};
	expect(spriteIds('hats', entries)).toEqual(new Set(['crown', 'cap']));
	expect(spriteIds('forms', entries)).toEqual(new Set(['buddy']));
});

test('spriteIds for an unknown role returns an empty set, never throws', () => {
	expect(spriteIds('nonexistent-role')).toEqual(new Set());
	expect(spriteIds('hats', {})).toEqual(new Set());
});

test('the store resolves the repo trees even when cwd is elsewhere (walk-up fallback)', () => {
	savedCwd = process.cwd();
	process.chdir(tmpdir());
	expect(spriteIds('hats').size).toBeGreaterThan(0);
	expect(loadZones().some((zone) => zone.type === 'town')).toBe(true);
});

test('loadZones through the meta door returns parsed Zones with a Town first', () => {
	const zones = loadZones();
	expect(zones.length).toBeGreaterThan(0);
	expect(zones[0].type).toBe('town');
});
