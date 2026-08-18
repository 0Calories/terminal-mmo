import { expect, test } from 'bun:test';

import { previousReleaseTag } from './release-shape';

test('picks the highest tag strictly below the current one', () => {
	const tags = ['v0.7.0', 'v0.8.0', 'v0.9.0', 'v0.10.0'];
	expect(previousReleaseTag(tags, 'v0.10.0')).toBe('v0.9.0');
	expect(previousReleaseTag(tags, 'v0.9.0')).toBe('v0.8.0');
});

test('sorts by version, not lexicographically', () => {
	expect(previousReleaseTag(['v0.2.0', 'v0.10.0'], 'v0.11.0')).toBe('v0.10.0');
});

test('ignores tags at or above the current one (re-run of an old tag)', () => {
	const tags = ['v0.8.0', 'v0.9.0', 'v0.10.0'];
	expect(previousReleaseTag(tags, 'v0.9.0')).toBe('v0.8.0');
});

test('returns undefined for the first release', () => {
	expect(previousReleaseTag([], 'v0.1.0')).toBeUndefined();
	expect(previousReleaseTag(['v0.1.0'], 'v0.1.0')).toBeUndefined();
});

test('skips non-release tags and treats prereleases as below their release', () => {
	expect(previousReleaseTag(['nightly', 'v1.0'], 'v1.0.0')).toBeUndefined();
	expect(previousReleaseTag(['v1.0.0-rc.1', 'v0.9.0'], 'v1.0.0')).toBe(
		'v1.0.0-rc.1',
	);
});

test('returns undefined when the current tag is not a release tag', () => {
	expect(previousReleaseTag(['v0.1.0'], 'nightly')).toBeUndefined();
});
