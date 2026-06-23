import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogs, loadZone, writeZone } from '../src/io';
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
		expect(loaded.text).toBe(text); // no glyph/identity loss on the disk trip
		expect(loaded.zone?.id).toBe('town-7');
	});

	// Atomic write (#98): the editor's explicit save must never leave a half-written
	// file if the process dies mid-write — write a sibling temp file then rename it
	// over the target. The save is all-or-nothing and leaves no stray temp files.
	test('overwrites an existing zone in place, leaving no temp files behind', () => {
		writeZone(root, 'town-7', newZoneTemplate('town-7', 'town'));
		const next = newZoneTemplate('town-7', 'field');
		writeZone(root, 'town-7', next);

		const loaded = loadZone(root, 'town-7', loadCatalogs(root));
		expect(loaded.text).toBe(next); // the rename swapped in the new content
		// Only the .zone survives — no leftover temp/partial files in the dir.
		expect(readdirSync(root)).toEqual(['town-7.zone']);
	});

	test('does not clobber the target when the new content fails to materialize', () => {
		// A pre-existing temp sibling must not interfere with a clean write.
		const text = newZoneTemplate('town-7', 'town');
		writeFileSync(join(root, 'town-7.zone.tmp'), 'garbage');
		writeZone(root, 'town-7', text);
		const loaded = loadZone(root, 'town-7', loadCatalogs(root));
		expect(loaded.text).toBe(text);
		expect(readdirSync(root)).toEqual(['town-7.zone']);
	});
});
