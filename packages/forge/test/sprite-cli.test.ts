import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSpriteFile, runSprite } from '../src/sprite-cli';
import { dirForRole } from '../src/sprite-editor/view';

let root: string;
let lines: string[];
const deps = () => ({ root, log: (s: string) => lines.push(s) });
const output = () => lines.join('\n');

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'forge-sprite-'));
	lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const VALID = `--- idle
AB
CD
--- wave
·A
B·
@bg
·s
··
`;

const RESERVED_KEY_ERROR = `{"colors": {"p": [1,2,3,255]}}
--- idle
AB
CD
`;

const BAD_JSON = `{ this is not json
--- idle
AB
`;

const CUSTOM_COLORS = `{"key": "e", "colors": {"q": [10,20,30,255]}}
--- idle
AB
CD
--- wave
·A
B·
@colors
·q
e·
@bg
·s
··
`;

const DEFAULT_COLORS = `{"key": "e"}
--- idle
AB
CD
@colors
ee
ee
`;

describe('sprite CLI', () => {
	test('render: happy path prints summary, frames, art, @bg, and no-issues', () => {
		writeFileSync(join(root, 'buddy.sprite'), VALID);
		expect(runSprite(['render', 'buddy'], deps())).toBe(0);
		const out = output();
		expect(out).toContain('buddy');
		expect(out).toContain('2 frame(s)');
		expect(out).toContain('--- idle  2×2');
		expect(out).toContain('--- wave  2×2');
		expect(out).toContain('·A');
		expect(out).toContain('B·');
		expect(out).toContain('@bg');
		expect(out).toContain('·s');
		expect(out).toContain('✓ no issues');
	});

	test('render: finds sprite in nested role dir via recursive scan', () => {
		mkdirSync(join(root, 'hats'), { recursive: true });
		writeFileSync(join(root, 'hats', 'cap.sprite'), VALID);
		expect(runSprite(['render', 'cap'], deps())).toBe(0);
		expect(output()).toContain('cap');
	});

	test('render: direct path works even with root pointing elsewhere', () => {
		mkdirSync(join(root, 'hats'), { recursive: true });
		const path = join(root, 'hats', 'cap.sprite');
		writeFileSync(path, VALID);
		const otherRoot = join(root, 'elsewhere');
		expect(
			runSprite(['render', path], {
				root: otherRoot,
				log: (s) => lines.push(s),
			}),
		).toBe(0);
		expect(output()).toContain('cap');
	});

	test('render: error diagnostics reported, exit 1, but frames still print', () => {
		writeFileSync(join(root, 'bad.sprite'), RESERVED_KEY_ERROR);
		expect(runSprite(['render', 'bad'], deps())).toBe(1);
		const out = output();
		expect(out).toContain("reserved recolor key 'p'");
		expect(out).toContain('--- idle  2×2');
	});

	test('render: frame with a non-default @colors grid prints @colors', () => {
		writeFileSync(join(root, 'recolor.sprite'), CUSTOM_COLORS);
		expect(runSprite(['render', 'recolor'], deps())).toBe(0);
		const out = output();
		expect(out).toContain('@colors');
		expect(out).toContain('·q');
		expect(out).toContain('e·');
	});

	test('render: frame whose @colors grid is all default key omits @colors', () => {
		writeFileSync(join(root, 'plain.sprite'), DEFAULT_COLORS);
		expect(runSprite(['render', 'plain'], deps())).toBe(0);
		expect(output()).not.toContain('@colors');
	});

	test('render: unparseable header -> no frames printed, exit 1', () => {
		writeFileSync(join(root, 'broken.sprite'), BAD_JSON);
		expect(runSprite(['render', 'broken'], deps())).toBe(1);
		const out = output();
		expect(out).toContain('invalid header JSON');
		expect(out).not.toContain('---');
	});

	test('render: missing id fails with a message', () => {
		expect(runSprite(['render'], deps())).toBe(1);
	});

	test('render: missing sprite id fails with a clear message', () => {
		expect(runSprite(['render', 'nope'], deps())).toBe(1);
		expect(output().toLowerCase()).toContain('nope');
	});

	test('render: missing sprites dir entirely fails cleanly, not a throw', () => {
		const missingRoot = join(root, 'nope-dir');
		expect(
			runSprite(['render', 'anything'], {
				root: missingRoot,
				log: (s) => lines.push(s),
			}),
		).toBe(1);
	});

	test('bare command prints usage and exits 0', () => {
		expect(runSprite([], deps())).toBe(0);
		expect(output().toLowerCase()).toContain('usage');
	});

	test('unknown command prints usage and exits 1', () => {
		expect(runSprite(['bogus'], deps())).toBe(1);
		expect(output().toLowerCase()).toContain('usage');
	});

	// Write a complete, valid set covering every @mmo/core catalog/reference id so
	// the whole-set reference check resolves cleanly.
	function writeCompleteSet(): void {
		const weapon = `{"anchors":{"grip":[0,0]},"animations":{"swing":["s0","s1","s2"]}}
--- idle
AB
--- s0
AB
--- s1
AB
--- s2
AB
`;
		const idle = `--- idle\nAB\n`;
		for (const [dir, id] of [['weapons', 'sword']] as const) {
			mkdirSync(join(root, dir), { recursive: true });
			writeFileSync(join(root, dir, `${id}.sprite`), weapon);
		}
		for (const id of ['chaser', 'shooter', 'brute']) {
			mkdirSync(join(root, 'monsters'), { recursive: true });
			writeFileSync(join(root, 'monsters', `${id}.sprite`), idle);
		}
		for (const id of ['merchant', 'fixture-npc']) {
			mkdirSync(join(root, 'npcs'), { recursive: true });
			writeFileSync(join(root, 'npcs', `${id}.sprite`), idle);
		}
	}

	test('check: a clean, complete sprite set exits 0 and reports no issues', () => {
		writeCompleteSet();
		expect(runSprite(['check'], deps())).toBe(0);
		expect(output()).toContain('no issues');
	});

	test('check: a set whose only diagnostics are warnings stays green (exit 0)', () => {
		writeCompleteSet();
		// An unknown header field is a warning, not an error, so the set still
		// resolves and `check` must exit 0 while printing the warning.
		mkdirSync(join(root, 'hats'), { recursive: true });
		writeFileSync(
			join(root, 'hats', 'warn.sprite'),
			`{"nope": 1}\n--- idle\nAB\n`,
		);
		expect(runSprite(['check'], deps())).toBe(0);
		const out = output();
		expect(out).toContain('warning');
		expect(out).toContain("unknown header field 'nope'");
	});

	test('check: dangling catalog references fail with exit 1', () => {
		// Only a hat present — the weapon/monster/npc catalog references dangle.
		mkdirSync(join(root, 'hats'), { recursive: true });
		writeFileSync(join(root, 'hats', 'cap.sprite'), `--- idle\nAB\n`);
		expect(runSprite(['check'], deps())).toBe(1);
		expect(output()).toContain('sword');
	});

	test('check: an error in a sprite file fails with exit 1 and prints the diagnostic', () => {
		writeCompleteSet();
		writeFileSync(join(root, 'hats-bad.sprite'), RESERVED_KEY_ERROR);
		mkdirSync(join(root, 'hats'), { recursive: true });
		writeFileSync(join(root, 'hats', 'bad.sprite'), RESERVED_KEY_ERROR);
		expect(runSprite(['check'], deps())).toBe(1);
		expect(output()).toContain("reserved recolor key 'p'");
	});

	test('check: an unresolvable color key fails with exit 1', () => {
		writeCompleteSet();
		mkdirSync(join(root, 'hats'), { recursive: true });
		writeFileSync(
			join(root, 'hats', 'badcol.sprite'),
			`{"colors":{"q":[1,2,3,255]}}\n--- idle\nAB\n@colors\nqz\n`,
		);
		expect(runSprite(['check'], deps())).toBe(1);
		expect(output()).toContain('unknown color key');
	});
});

describe('findSpriteFile', () => {
	// The launch forms `forge sprite edit <dir>/<id>` and the unified picker's
	// reconstructed `dirForRole(role)/id` argument must resolve against the
	// sprites root, not only cwd — a slash id that silently missed the root used
	// to fall through to "create a fresh empty template" (the empty-canvas bug).
	test('a role/id slash form resolves under the sprites root when cwd is elsewhere', () => {
		mkdirSync(join(root, 'forms'), { recursive: true });
		const path = join(root, 'forms', 'buddy.sprite');
		writeFileSync(path, VALID);
		expect(findSpriteFile(root, 'forms/buddy')).toBe(path);
		expect(findSpriteFile(root, 'forms/buddy.sprite')).toBe(path);
	});

	test("the picker's dirForRole(role)/id launch form finds the existing file", () => {
		mkdirSync(join(root, 'forms'), { recursive: true });
		const path = join(root, 'forms', 'buddy.sprite');
		writeFileSync(path, VALID);
		expect(findSpriteFile(root, `${dirForRole('form')}/buddy`)).toBe(path);
	});

	test('a bare id still searches the root recursively', () => {
		mkdirSync(join(root, 'hats'), { recursive: true });
		const path = join(root, 'hats', 'cap.sprite');
		writeFileSync(path, VALID);
		expect(findSpriteFile(root, 'cap')).toBe(path);
	});

	test('an absolute path is honoured as-is', () => {
		mkdirSync(join(root, 'forms'), { recursive: true });
		const path = join(root, 'forms', 'buddy.sprite');
		writeFileSync(path, VALID);
		expect(findSpriteFile(root, path)).toBe(path);
	});

	test('a missing slash id returns undefined (the caller creates from template)', () => {
		expect(findSpriteFile(root, 'forms/nope')).toBeUndefined();
	});
});

describe('sprite glyphs — rail icon eyeball check', () => {
	test('prints every tool glyph with its fallback in one row, exit 0', () => {
		expect(runSprite(['glyphs'], deps())).toBe(0);
		const row = output();
		expect(row).toContain('✎'); // pencil candidate
		expect(row).toContain('⌖'); // select fallback
		expect(row).toContain('pencil');
		// One row: the whole point is a single glance in the terminal.
		expect(row.trim()).not.toContain('\n');
	});
});
