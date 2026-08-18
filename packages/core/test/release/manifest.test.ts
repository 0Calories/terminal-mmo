import { expect, test } from 'bun:test';
import { classifyPath } from '../../src/release';

test('contract: shared sim, assets plumbing, zone data, lockfile', () => {
	for (const path of [
		'packages/core/src/protocol/protocol.ts',
		'packages/core/src/zones/zone.ts',
		'packages/core/package.json',
		'packages/assets/src/meta.ts',
		'zones/field-01.zone',
		'zones/catalogs.json',
		'bun.lock',
		'package.json',
	]) {
		expect(classifyPath(path)).toBe('contract');
	}
});

test('server-only: server package and deploy surface', () => {
	for (const path of [
		'packages/server/src/index.ts',
		'packages/server/package.json',
		'Dockerfile',
		'.dockerignore',
		'railway.json',
	]) {
		expect(classifyPath(path)).toBe('server-only');
	}
});

test('client-only: client, cli, render, sprite art', () => {
	for (const path of [
		'packages/client/src/index.ts',
		'packages/cli/build.ts',
		'packages/render/src/sprite.ts',
		'sprites/hats/wizard.sprite',
		'sprites/forms/buddy.sprite',
	]) {
		expect(classifyPath(path)).toBe('client-only');
	}
});

test('neither: docs, CI, dev tooling, repo config', () => {
	for (const path of [
		'docs/adr/0042-content-derived-releases-and-durable-saves.md',
		'.github/workflows/ci.yml',
		'README.md',
		'CONTEXT.md',
		'packages/forge/bin/forge.ts',
		'scripts/reset-dev.ts',
		'biome.json',
		'tsconfig.base.json',
		'bunfig.toml',
		'.gitignore',
		'packages/core/tsconfig.tsbuildinfo',
	]) {
		expect(classifyPath(path)).toBe('neither');
	}
});

test('unknown paths are unclassified, not defaulted', () => {
	expect(classifyPath('packages/newpkg/src/index.ts')).toBeUndefined();
	expect(classifyPath('stray-file.txt')).toBeUndefined();
	expect(classifyPath('assets/logo.png')).toBeUndefined();
});
