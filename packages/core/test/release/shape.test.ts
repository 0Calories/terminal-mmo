import { expect, test } from 'bun:test';
import { releaseShape } from '../../src/release';

test('contract change anywhere ships both', () => {
	expect(releaseShape(['packages/core/src/zones/zone.ts'])).toBe('both');
	expect(releaseShape(['README.md', 'zones/field-01.zone'])).toBe('both');
});

test('server-only changes ship the server', () => {
	expect(releaseShape(['packages/server/src/index.ts', 'Dockerfile'])).toBe(
		'server',
	);
});

test('client-only changes ship the client', () => {
	expect(
		releaseShape(['sprites/hats/wizard.sprite', 'packages/cli/build.ts']),
	).toBe('client');
});

test('server-only plus client-only ships both', () => {
	expect(
		releaseShape(['packages/server/src/store.ts', 'packages/client/src/ui.ts']),
	).toBe('both');
});

test('neither-only changes ship nothing', () => {
	expect(
		releaseShape(['docs/adr/0002-world-authority-and-wire.md', 'biome.json']),
	).toBe('none');
	expect(releaseShape([])).toBe('none');
});

test('unknown paths fail safe to both', () => {
	expect(releaseShape(['stray-file.txt'])).toBe('both');
});
