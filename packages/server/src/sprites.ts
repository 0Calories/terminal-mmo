import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// A hat exists iff `sprites/hats/<id>.sprite` exists. Resolution mirrors the
// render seam's findSpritesDir (packages/render/src/sprite-sources.ts): try
// process.cwd()/sprites/hats first (the Docker image copies the repo to /app
// and runs with cwd /app, so process.cwd() is right there — same assumption
// as bin/forge.ts), then walk up from this file's directory a few levels
// looking for sprites/hats, so the scan still finds the real set when the
// server isn't started from the repo root (e.g. under a test runner).
// Non-recursive: hat sprites are never nested.
export function findHatsDir(): string | undefined {
	const cwdCandidate = join(process.cwd(), 'sprites', 'hats');
	if (existsSync(cwdCandidate)) return cwdCandidate;

	let current = import.meta.dir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(current, 'sprites', 'hats');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return undefined;
}

export function scanHatIds(dir = findHatsDir()): ReadonlySet<string> {
	if (dir === undefined) return new Set();
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return new Set();
	}
	const ids = new Set<string>();
	for (const name of entries) {
		if (name.endsWith('.sprite')) ids.add(name.slice(0, -'.sprite'.length));
	}
	return ids;
}
