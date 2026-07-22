import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	loadSpriteSources,
	readSpriteSourcesFromDir,
	spriteSourcesFromEntries,
} from '../src';

const cleanupDirs: string[] = [];
let savedCwd: string | undefined;

afterEach(() => {
	if (savedCwd) {
		process.chdir(savedCwd);
		savedCwd = undefined;
	}
	for (const dir of cleanupDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('spriteSourcesFromEntries (the embedded-map strategy)', () => {
	it('splits role/id from sprites/<role>/<id>.sprite and keys the map by id', () => {
		const map = spriteSourcesFromEntries({
			'sprites/hats/cap.sprite': 'cap-text',
			'sprites/forms/buddy.sprite': 'buddy-text',
		});
		expect(map.get('cap')).toEqual({
			id: 'cap',
			role: 'hats',
			text: 'cap-text',
		});
		expect(map.get('buddy')).toEqual({
			id: 'buddy',
			role: 'forms',
			text: 'buddy-text',
		});
	});

	it('ignores entries of other asset kinds', () => {
		const map = spriteSourcesFromEntries({
			'zones/town-01.zone': 'zone-text',
			'zones/catalogs.json': '{}',
			'sprites/hats/notes.txt': 'not a sprite',
		});
		expect(map.size).toBe(0);
	});

	it('takes role as first segment and id as last segment for nested paths', () => {
		const map = spriteSourcesFromEntries({
			'sprites/hats/sub/dir/cap.sprite': 'nested-cap-text',
		});
		expect(map.get('cap')).toEqual({
			id: 'cap',
			role: 'hats',
			text: 'nested-cap-text',
		});
	});

	it('resolves id collisions deterministically: last in key order wins', () => {
		const map = spriteSourcesFromEntries({
			'sprites/hats/cap.sprite': 'second',
			'sprites/forms/cap.sprite': 'first',
		});
		expect(map.size).toBe(1);
		expect(map.get('cap')).toEqual({
			id: 'cap',
			role: 'hats',
			text: 'second',
		});
	});
});

describe('readSpriteSourcesFromDir', () => {
	it('recursively scans .sprite files and ignores non-sprite files', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sprite-sources-'));
		cleanupDirs.push(dir);

		mkdirSync(join(dir, 'hats', 'nested'), { recursive: true });
		mkdirSync(join(dir, 'forms'), { recursive: true });

		writeFileSync(join(dir, 'hats', 'cap.sprite'), 'cap-contents');
		writeFileSync(
			join(dir, 'hats', 'nested', 'fancy.sprite'),
			'fancy-contents',
		);
		writeFileSync(join(dir, 'forms', 'buddy.sprite'), 'buddy-contents');
		writeFileSync(join(dir, 'forms', 'readme.txt'), 'not a sprite');

		const map = readSpriteSourcesFromDir(dir);

		expect(map.size).toBe(3);
		expect(map.get('cap')).toEqual({
			id: 'cap',
			role: 'hats',
			text: 'cap-contents',
		});
		expect(map.get('fancy')).toEqual({
			id: 'fancy',
			role: 'hats',
			text: 'fancy-contents',
		});
		expect(map.get('buddy')).toEqual({
			id: 'buddy',
			role: 'forms',
			text: 'buddy-contents',
		});
		expect(map.has('readme')).toBe(false);
	});

	it('returns an empty map for a missing directory', () => {
		const map = readSpriteSourcesFromDir(
			join(tmpdir(), 'sprite-sources-does-not-exist-xyz'),
		);
		expect(map.size).toBe(0);
	});
});

describe('loadSpriteSources (fs-scan strategy)', () => {
	it('finds a sprites/ dir via cwd and reads it', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sprite-sources-cwd-'));
		cleanupDirs.push(dir);

		mkdirSync(join(dir, 'sprites', 'hats'), { recursive: true });
		writeFileSync(join(dir, 'sprites', 'hats', 'cap.sprite'), 'cap-contents');

		savedCwd = process.cwd();
		process.chdir(dir);

		const map = loadSpriteSources();

		expect(map.get('cap')).toEqual({
			id: 'cap',
			role: 'hats',
			text: 'cap-contents',
		});
	});

	it('re-reads on every call: a hand edit shows up without a rebuild', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sprite-sources-edit-'));
		cleanupDirs.push(dir);

		mkdirSync(join(dir, 'sprites', 'hats'), { recursive: true });
		writeFileSync(join(dir, 'sprites', 'hats', 'cap.sprite'), 'v1');

		savedCwd = process.cwd();
		process.chdir(dir);

		expect(loadSpriteSources().get('cap')?.text).toBe('v1');
		writeFileSync(join(dir, 'sprites', 'hats', 'cap.sprite'), 'v2');
		expect(loadSpriteSources().get('cap')?.text).toBe('v2');
	});
});

it('the real repo sprite tree loads every supported role', () => {
	const map = loadSpriteSources();
	const roles = new Set([...map.values()].map((s) => s.role));
	for (const role of ['forms', 'hats', 'monsters', 'npcs', 'weapons'])
		expect(roles.has(role)).toBe(true);
});
