import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeContractHash, loadContractEntries } from '../src/contract';

const repoRoot = join(import.meta.dir, '..', '..', '..');

function makeRoot(name: string): string {
	const root = join(
		process.env.TMPDIR ?? '/tmp',
		`contract-test-${name}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(root, 'zones'), { recursive: true });
	mkdirSync(join(root, 'sprites', 'hats'), { recursive: true });
	writeFileSync(join(root, 'zones', 'town.zone'), 'zone-body');
	writeFileSync(join(root, 'sprites', 'hats', 'crown.sprite'), 'art');
	writeFileSync(join(root, 'package.json'), '{}');
	return root;
}

describe('loadContractEntries', () => {
	test('collects zones, contract files, and sprite bodies from a root', () => {
		const root = makeRoot('collect');
		const entries = loadContractEntries(root);
		expect(entries['zones/town.zone']).toBe('zone-body');
		expect(entries['sprites/hats/crown.sprite']).toBe('art');
		expect(entries['package.json']).toBe('{}');
	});

	test('ignores generated files outside contract roots', () => {
		const root = makeRoot('generated');
		writeFileSync(join(root, 'build-info.json'), '{"gitSha":"x"}');
		writeFileSync(join(root, 'mmo-state.sqlite'), 'binary-ish');
		const before = computeContractHash(root);
		writeFileSync(join(root, 'build-info.json'), '{"gitSha":"y"}');
		writeFileSync(join(root, 'mmo-state.sqlite'), 'mutated');
		expect(computeContractHash(root)).toBe(before);
	});

	test('sprite art edits leave the hash unchanged; zone edits change it', () => {
		const root = makeRoot('sensitivity');
		const before = computeContractHash(root);
		writeFileSync(join(root, 'sprites', 'hats', 'crown.sprite'), 'new-art');
		expect(computeContractHash(root)).toBe(before);
		writeFileSync(join(root, 'zones', 'town.zone'), 'moved-portal');
		expect(computeContractHash(root)).not.toBe(before);
	});

	test('is deterministic over the real repo', () => {
		expect(computeContractHash(repoRoot)).toBe(computeContractHash(repoRoot));
	});
});
