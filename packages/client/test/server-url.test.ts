import { expect, test } from 'bun:test';
import { DEV_VERSION } from '@mmo/core/protocol';
import {
	LOCAL_SERVER_URL,
	PROD_SERVER_URL,
	resolveServerUrl,
} from '../src/server-url';

test('server selection prefers an override, then separates dev from releases', () => {
	expect(resolveServerUrl('ws://example:9999', DEV_VERSION)).toBe(
		'ws://example:9999',
	);
	expect(resolveServerUrl('ws://example:9999', '1.2.3')).toBe(
		'ws://example:9999',
	);
	expect(resolveServerUrl(undefined, DEV_VERSION)).toBe(LOCAL_SERVER_URL);
	expect(resolveServerUrl('', DEV_VERSION)).toBe(LOCAL_SERVER_URL);
	expect(resolveServerUrl(undefined, '0.3.0')).toBe(PROD_SERVER_URL);
});
