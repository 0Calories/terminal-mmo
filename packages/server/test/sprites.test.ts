import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHatsDir, scanHatIds } from '../src/sprites';

test('scanHatIds finds .sprite basenames and ignores everything else (explicit dir)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'hats-'));
	try {
		writeFileSync(join(dir, 'crown.sprite'), 'x');
		writeFileSync(join(dir, 'cap.sprite'), 'x');
		writeFileSync(join(dir, 'notes.txt'), 'x');
		writeFileSync(join(dir, 'README'), 'x');
		const ids = scanHatIds(dir);
		expect(ids).toEqual(new Set(['crown', 'cap']));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('scanHatIds on an explicit missing directory returns an empty set, never throws', () => {
	const missing = join(tmpdir(), 'definitely-does-not-exist-hats-dir');
	expect(scanHatIds(missing)).toEqual(new Set());
});

test('findHatsDir resolves the repo root sprites/hats dir even when cwd is elsewhere (fallback walk-up)', () => {
	// This test file itself runs from somewhere under the repo, so the
	// walk-up-from-import.meta.dir fallback should find the real
	// sprites/hats directory regardless of process.cwd().
	const dir = findHatsDir();
	expect(dir).toBeDefined();
	expect(dir).toMatch(/sprites[/\\]hats$/);
});

test('scanHatIds with no dir argument resolves via findHatsDir and finds the real hat set', () => {
	// Real hats shipped in this repo (ADR 0031): cap, crown, party-hat, top-hat, wizard.
	const ids = scanHatIds();
	for (const id of ['cap', 'crown', 'party-hat', 'top-hat', 'wizard'])
		expect(ids.has(id)).toBe(true);
});
