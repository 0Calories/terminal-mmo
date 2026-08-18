import { expect, test } from 'bun:test';
import { assertBootIdentity, makeStamp, parseStamp } from '../../src/release';

const STAMP = {
	version: '0.9.0',
	gitSha: 'abc123def456',
	contractHash: 'cafe0000',
};

test('makeStamp returns the build-info shape', () => {
	expect(makeStamp(STAMP)).toEqual(STAMP);
});

test('makeStamp trims whitespace', () => {
	expect(
		makeStamp({
			version: ' 0.9.0 ',
			gitSha: 'abc123def456\n',
			contractHash: 'cafe0000',
		}),
	).toEqual(STAMP);
});

test('makeStamp rejects empty fields', () => {
	expect(() => makeStamp({ ...STAMP, version: '' })).toThrow();
	expect(() => makeStamp({ ...STAMP, gitSha: '  ' })).toThrow();
	expect(() => makeStamp({ ...STAMP, contractHash: '' })).toThrow();
});

test('parseStamp round-trips a stamp file', () => {
	expect(parseStamp(JSON.stringify(STAMP))).toEqual(STAMP);
});

test('parseStamp rejects malformed input', () => {
	expect(parseStamp('not json')).toBeUndefined();
	expect(parseStamp('null')).toBeUndefined();
	expect(parseStamp('"stamp"')).toBeUndefined();
	expect(parseStamp(JSON.stringify({ version: '0.9.0' }))).toBeUndefined();
	expect(parseStamp(JSON.stringify({ ...STAMP, gitSha: 42 }))).toBeUndefined();
	expect(
		parseStamp(JSON.stringify({ ...STAMP, contractHash: '' })),
	).toBeUndefined();
});

test('boot without a stamp is fine outside Railway', () => {
	expect(() =>
		assertBootIdentity({
			railwayEnv: undefined,
			stamp: undefined,
			recomputedHash: 'cafe0000',
		}),
	).not.toThrow();
});

test('boot on Railway without a stamp refuses', () => {
	expect(() =>
		assertBootIdentity({
			railwayEnv: 'production',
			stamp: undefined,
			recomputedHash: 'cafe0000',
		}),
	).toThrow(/build-info\.json is missing/);
});

test('stamp disagreeing with loaded content refuses', () => {
	expect(() =>
		assertBootIdentity({
			railwayEnv: undefined,
			stamp: STAMP,
			recomputedHash: 'beef1111',
		}),
	).toThrow(/does not match/);
});

test('stamp matching loaded content boots', () => {
	expect(() =>
		assertBootIdentity({
			railwayEnv: 'production',
			stamp: STAMP,
			recomputedHash: STAMP.contractHash,
		}),
	).not.toThrow();
});
