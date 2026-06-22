import { expect, test } from 'bun:test';
import { DEV_VERSION } from '@mmo/shared';
import {
	LOCAL_SERVER_URL,
	PROD_SERVER_URL,
	resolveServerUrl,
} from '../src/server-url';

test('an explicit MMO_SERVER override wins regardless of version', () => {
	expect(resolveServerUrl('ws://example:9999', DEV_VERSION)).toBe(
		'ws://example:9999',
	);
	expect(resolveServerUrl('ws://example:9999', '1.2.3')).toBe(
		'ws://example:9999',
	);
});

test('a dev-versioned client with no override targets the LOCAL dev server', () => {
	// A `dev` client is rejected by any deployed server, so defaulting it to prod is a
	// guaranteed-failure footgun; it should hit the local dev server instead.
	expect(resolveServerUrl(undefined, DEV_VERSION)).toBe(LOCAL_SERVER_URL);
	expect(resolveServerUrl('', DEV_VERSION)).toBe(LOCAL_SERVER_URL);
});

test('a release-versioned client with no override targets the production World', () => {
	expect(resolveServerUrl(undefined, '0.3.0')).toBe(PROD_SERVER_URL);
});
