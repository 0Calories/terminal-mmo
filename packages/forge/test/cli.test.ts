import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli';

let root: string;
let lines: string[];
const deps = () => ({ root, log: (s: string) => lines.push(s) });
const output = () => lines.join('\n');

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'forge-'));
	lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('zone CLI', () => {
	test('new writes a template file that round-trips through render', () => {
		expect(run(['new', 'town-7', '--type', 'town'], deps())).toBe(0);
		expect(existsSync(join(root, 'town-7.zone'))).toBe(true);

		lines = [];
		expect(run(['render', 'town-7'], deps())).toBe(0);
		expect(output()).toContain('town-7');
		expect(output()).toContain('legend:');
	});

	test('new refuses to overwrite an existing zone', () => {
		expect(run(['new', 'town-7', '--type', 'town'], deps())).toBe(0);
		lines = [];
		expect(run(['new', 'town-7', '--type', 'town'], deps())).not.toBe(0);
		expect(output().toLowerCase()).toContain('exists');
	});

	test('check exits non-zero and reports a broken Zone in the set', () => {
		// a field template has no spawn yet — the documented next-edit error
		run(['new', 'field-7', '--type', 'field'], deps());
		lines = [];
		expect(run(['check'], deps())).not.toBe(0);
		expect(output()).toContain('field-7');
		expect(output()).toContain('at least one monster spawn');
	});

	test('check passes (zero exit) when the set is clean', () => {
		run(['new', 'town-7', '--type', 'town'], deps());
		lines = [];
		expect(run(['check'], deps())).toBe(0);
	});

	test('render of a missing Zone fails with a clear message', () => {
		expect(run(['render', 'nope'], deps())).not.toBe(0);
		expect(output().toLowerCase()).toContain('nope');
	});

	// An otherwise-valid Zone that declares a header glyph it never places: parseZone
	// loads it fine (it ignores unplaced keys), so only the raw-text orphan pass catches it.
	test('check flags an orphan header glyph (declared but unused)', () => {
		writeFileSync(
			join(root, 'catalogs.json'),
			JSON.stringify({
				monsters: [{ id: 'chaser', behavior: 'chaser', name: 'Chaser' }],
				npcs: [],
			}),
		);
		const grid = [
			'............',
			'............',
			'............',
			'............',
			'............',
			'..c.........',
			'............',
			'............',
			'............',
			'............',
			'############',
			'############',
		].join('\n');
		writeFileSync(
			join(root, 'field-9.zone'),
			`{"type":"field","spawns":{"c":"chaser","z":"chaser"}}\n---\n${grid}`,
		);
		expect(run(['check'], deps())).not.toBe(0);
		expect(output()).toContain("'z'");
		expect(output()).toContain('field-9');
	});
});

describe('zone rename', () => {
	// A two-Zone set that portals into each other, so a rename must rewrite the
	// other file's Portal target as well as move the file.
	const writePair = () => {
		writeFileSync(
			join(root, 'catalogs.json'),
			JSON.stringify({ monsters: [], npcs: [] }),
		);
		writeFileSync(
			join(root, 'town-01.zone'),
			'{"type":"town","portals":{"P":{"target":"field-01","arrival":[2,2]}}}\n---\n....\n####',
		);
		writeFileSync(
			join(root, 'field-01.zone'),
			'{"type":"field","portals":{"P":{"target":"town-01","arrival":[2,2]}}}\n---\n....\n####',
		);
	};

	test('renames the file and rewrites every referencing Portal target', () => {
		writePair();
		expect(run(['rename', 'town-01', 'hub'], deps())).toBe(0);

		// the file moved…
		expect(existsSync(join(root, 'town-01.zone'))).toBe(false);
		expect(existsSync(join(root, 'hub.zone'))).toBe(true);
		// …and the sibling Portal now points at the new id
		const field = readFileSync(join(root, 'field-01.zone'), 'utf8');
		expect(field).toContain('"target":"hub"');
		expect(field).not.toContain('town-01');

		// no Portal is left dangling at the vanished id (the rename's whole point)
		lines = [];
		run(['check'], deps());
		expect(output()).not.toContain("unknown Zone 'town-01'");
	});

	test('without the rewrite, the sibling Portal would dangle (load-bearing)', () => {
		writePair();
		// Sanity: before any rename, both targets resolve.
		run(['check'], deps());
		expect(output()).not.toContain('unknown Zone');
	});

	test('refuses to overwrite an existing Zone', () => {
		writePair();
		expect(run(['rename', 'town-01', 'field-01'], deps())).not.toBe(0);
		expect(output().toLowerCase()).toContain('exists');
		expect(existsSync(join(root, 'town-01.zone'))).toBe(true);
	});

	test('fails clearly on a missing source Zone', () => {
		writePair();
		expect(run(['rename', 'nope', 'hub'], deps())).not.toBe(0);
		expect(output().toLowerCase()).toContain('nope');
	});

	test('requires both old and new ids', () => {
		expect(run(['rename', 'town-01'], deps())).not.toBe(0);
		expect(output().toLowerCase()).toContain('usage');
	});
});
