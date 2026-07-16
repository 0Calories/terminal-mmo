// @mmo/assets/meta — the server's door. Absorbs the old server sprite-scan
// tests: set-membership for cosmetic-id sanitization, backed by the same
// store as the full door (fs-scan here; entries injection proves the
// embedded strategy).
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

test('spriteIds finds the real hat set (ADR 0031): cap, crown, party-hat, top-hat, wizard', () => {
	const ids = spriteIds('hats');
	for (const id of ['cap', 'crown', 'party-hat', 'top-hat', 'wizard'])
		expect(ids.has(id)).toBe(true);
});

test('spriteIds finds the shipped Form set: the default buddy is a member', () => {
	expect(spriteIds('forms').has('buddy')).toBe(true);
});

test('the store resolves the repo trees even when cwd is elsewhere (walk-up fallback)', () => {
	// Mirrors the old server findHatsDir test: from a cwd with no asset trees,
	// the walk-up from this package's directory still finds the real content.
	savedCwd = process.cwd();
	process.chdir(tmpdir());
	expect(spriteIds('hats').has('cap')).toBe(true);
	expect(loadZones().some((z) => z.id === 'town-01')).toBe(true);
});

test('loadZones through the meta door is the parsed, start-Town-first zone list', () => {
	const zones = loadZones();
	expect(zones[0].id).toBe('town-01');
	expect(zones[0].type).toBe('town');
	expect(zones.length).toBeGreaterThanOrEqual(5);
});
