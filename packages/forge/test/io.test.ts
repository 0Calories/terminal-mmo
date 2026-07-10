import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogs, loadZone } from '@mmo/assets';
import { rewritePortalTarget, writeZone } from '../src/io';
import { newZoneTemplate } from '../src/template';

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'zone-io-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('writeZone', () => {
	test('writes a .zone that loadZone reads back with identical text', () => {
		const text = newZoneTemplate('town-7', 'town');
		writeZone(root, 'town-7', text);

		const loaded = loadZone(root, 'town-7', loadCatalogs(root));
		expect(loaded.parseError).toBeUndefined();
		expect(loaded.text).toBe(text);
		expect(loaded.zone?.id).toBe('town-7');
	});

	test('overwrites an existing zone in place, leaving no temp files behind', () => {
		writeZone(root, 'town-7', newZoneTemplate('town-7', 'town'));
		const next = newZoneTemplate('town-7', 'field');
		writeZone(root, 'town-7', next);

		const loaded = loadZone(root, 'town-7', loadCatalogs(root));
		expect(loaded.text).toBe(next);
		expect(readdirSync(root)).toEqual(['town-7.zone']);
	});

	test('does not clobber the target when the new content fails to materialize', () => {
		const text = newZoneTemplate('town-7', 'town');
		writeFileSync(join(root, 'town-7.zone.tmp'), 'garbage');
		writeZone(root, 'town-7', text);
		const loaded = loadZone(root, 'town-7', loadCatalogs(root));
		expect(loaded.text).toBe(text);
		expect(readdirSync(root)).toEqual(['town-7.zone']);
	});
});

describe('rewritePortalTarget (the `zone rename` refactor)', () => {
	const file = (header: string) => `${header}\n---\n....\n####`;

	test('rewrites a Portal target that references the old id', () => {
		const text = file(
			'{"type":"field","portals":{"P":{"target":"town-01","arrival":[1,1]}}}',
		);
		const out = rewritePortalTarget(text, 'town-01', 'hub');
		expect(out).toContain('"target":"hub"');
		expect(out).not.toContain('town-01');
	});

	test('leaves Portal targets that reference a different id untouched', () => {
		const text = file(
			'{"type":"field","portals":{"P":{"target":"other-zone","arrival":[1,1]}}}',
		);
		expect(rewritePortalTarget(text, 'town-01', 'hub')).toBe(text);
	});

	test('rewrites every matching target (multiple portals)', () => {
		const text = file(
			'{"type":"town","portals":{' +
				'"A":{"target":"field-01","arrival":[1,1]},' +
				'"B":{"target":"field-01","arrival":[2,2]}}}',
		);
		const out = rewritePortalTarget(text, 'field-01', 'meadow');
		expect(out.match(/"target":"meadow"/g)).toHaveLength(2);
		expect(out).not.toContain('field-01');
	});

	test('only the old id is a whole-value match — a prefix is not rewritten', () => {
		const text = file(
			'{"type":"field","portals":{"P":{"target":"town-01-annex","arrival":[1,1]}}}',
		);
		expect(rewritePortalTarget(text, 'town-01', 'hub')).toBe(text);
	});

	test('does not touch the grid body even if it contains the literal', () => {
		const text = `{"type":"field"}\n---\n"target":"town-01"\n####`;
		expect(rewritePortalTarget(text, 'town-01', 'hub')).toBe(text);
	});
});
