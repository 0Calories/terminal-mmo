// Computes the release shape for a tag: which artifacts (server/client) the
// diff since the previous release actually touched. Prints exactly one of
// both|server|client|none on stdout; diagnostics go to stderr.
//
// Usage: bun run scripts/release-shape.ts --tag v1.2.3 [--force]
//   --force ships everything (shape 'both') regardless of the diff.
import { join } from 'node:path';

import { releaseShape } from '../packages/core/src/release/index.ts';

const root = join(import.meta.dir, '..');

type SemVer = readonly [number, number, number, string | undefined];

function parseReleaseTag(tag: string): SemVer | undefined {
	const match = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(tag);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

function compareSemVer(a: SemVer, b: SemVer): number {
	for (const i of [0, 1, 2] as const) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	// A prerelease sorts before the release with the same triple.
	if (a[3] === b[3]) return 0;
	if (a[3] === undefined) return 1;
	if (b[3] === undefined) return -1;
	return a[3] < b[3] ? -1 : 1;
}

// The previous release is the highest v* tag strictly below `current`
// (version order, not tag-creation order); undefined when this is the first.
export function previousReleaseTag(
	tags: readonly string[],
	current: string,
): string | undefined {
	const currentVersion = parseReleaseTag(current);
	if (!currentVersion) return undefined;
	let best: { tag: string; version: SemVer } | undefined;
	for (const tag of tags) {
		if (tag === current) continue;
		const version = parseReleaseTag(tag);
		if (!version) continue;
		if (compareSemVer(version, currentVersion) >= 0) continue;
		if (!best || compareSemVer(version, best.version) > 0) {
			best = { tag, version };
		}
	}
	return best?.tag;
}

function git(...args: string[]): string {
	const proc = Bun.spawnSync(['git', ...args], { cwd: root });
	if (proc.exitCode !== 0) {
		console.error(`release shape: git ${args.join(' ')} failed`);
		console.error(proc.stderr.toString());
		process.exit(1);
	}
	return proc.stdout.toString();
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const tagFlag = args.indexOf('--tag');
	const tag = tagFlag >= 0 ? args[tagFlag + 1] : undefined;
	if (!tag) {
		console.error('usage: release-shape.ts --tag <vX.Y.Z> [--force]');
		process.exit(1);
	}
	if (!parseReleaseTag(tag)) {
		console.error(`release shape: '${tag}' is not a vX.Y.Z release tag`);
		process.exit(1);
	}

	if (args.includes('--force')) {
		console.error(`release shape for ${tag}: both (forced by operator)`);
		console.log('both');
		process.exit(0);
	}

	const tags = git('tag', '--list', 'v*').trim().split('\n').filter(Boolean);
	const previous = previousReleaseTag(tags, tag);
	if (!previous) {
		console.error(`release shape for ${tag}: both (no previous release tag)`);
		console.log('both');
		process.exit(0);
	}

	const changed = git('diff', '--name-only', `${previous}..${tag}`)
		.trim()
		.split('\n')
		.filter(Boolean);
	const shape = releaseShape(changed);
	console.error(
		`release shape for ${tag}: ${shape} (${changed.length} paths changed since ${previous})`,
	);
	console.log(shape);
}
