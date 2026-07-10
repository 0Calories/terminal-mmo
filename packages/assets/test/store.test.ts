// The strategy switch itself: when the bundler-injected MMO_EMBEDDED_ASSETS
// global exists, the whole store — both doors — serves from it and never
// touches the filesystem. At runtime the `declare const` in store.ts resolves
// through globalThis, so a test can stand in for the compiled-binary define.
import { afterEach, expect, test } from 'bun:test';
import type { AssetEntries } from '../src';
import { loadSpriteSources } from '../src';
import { loadZones, spriteIds } from '../src/meta';
import { CATALOGS_JSON, TOWN_TEXT } from './fixtures';

const g = globalThis as { MMO_EMBEDDED_ASSETS?: AssetEntries };

afterEach(() => {
	delete g.MMO_EMBEDDED_ASSETS;
});

test('the embedded define switches every loader off the fs: both doors serve the map', () => {
	g.MMO_EMBEDDED_ASSETS = {
		'zones/catalogs.json': CATALOGS_JSON,
		'zones/t.zone': TOWN_TEXT,
		'sprites/hats/fez.sprite': 'fez-text',
	};

	// The real repo trees hold town-01 and five hats; seeing only the injected
	// content proves the fs strategy was bypassed entirely.
	expect(loadZones().map((z) => z.id)).toEqual(['t']);
	expect(loadSpriteSources().get('fez')?.text).toBe('fez-text');
	expect(spriteIds('hats')).toEqual(new Set(['fez']));
});

test('an empty embedded map still short-circuits the fs: no assets, no crash', () => {
	g.MMO_EMBEDDED_ASSETS = {};
	expect(loadZones()).toEqual([]);
	expect(loadSpriteSources().size).toBe(0);
	expect(spriteIds('hats')).toEqual(new Set());
});
