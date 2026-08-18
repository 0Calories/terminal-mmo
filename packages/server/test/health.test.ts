import { afterEach, expect, test } from 'bun:test';
import { loadZones, spriteIds } from '@mmo/assets/meta';
import {
	createServerRuntime,
	type ServerRuntime,
	type ServerRuntimeOptions,
} from '../src/runtime';
import { openPlayerStore } from '../src/store';

const runtimes: ServerRuntime[] = [];

afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime.close();
});

function setup(overrides: Partial<ServerRuntimeOptions> = {}) {
	const runtime = createServerRuntime({
		zones: loadZones(),
		store: openPlayerStore(':memory:'),
		releaseVersion: 'dev',
		contractHash: 'dev',
		nonce: () => new Uint8Array(32).fill(7),
		validHatIds: spriteIds('hats'),
		validFormIds: spriteIds('forms'),
		log: () => {},
		logError: () => {},
		...overrides,
	});
	runtimes.push(runtime);
	return runtime;
}

test('health reports stamp identity and the boot-recomputed contract hash', () => {
	const runtime = setup({
		releaseVersion: '0.9.0',
		gitSha: 'abc123def456',
		contractHash: 'cafe0000',
	});
	expect(runtime.health()).toEqual({
		status: 'ok',
		version: '0.9.0',
		gitSha: 'abc123def456',
		contractHash: 'cafe0000',
	});
});

test('health falls back to dev identity when unstamped', () => {
	const runtime = setup();
	expect(runtime.health()).toEqual({
		status: 'ok',
		version: 'dev',
		gitSha: 'dev',
		contractHash: 'dev',
	});
});
