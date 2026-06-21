import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli';

let root: string;
let lines: string[];
const deps = () => ({ root, log: (s: string) => lines.push(s) });
const output = () => lines.join('\n');

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'zone-tools-'));
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
});
