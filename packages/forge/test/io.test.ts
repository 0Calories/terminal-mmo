import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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
});
