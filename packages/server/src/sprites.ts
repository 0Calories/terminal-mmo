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
function findSpriteKindDir(kind: string): string | undefined {
	const cwdCandidate = join(process.cwd(), 'sprites', kind);
	if (existsSync(cwdCandidate)) return cwdCandidate;

	let current = import.meta.dir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(current, 'sprites', kind);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return undefined;
}

function scanSpriteIds(dir: string | undefined): ReadonlySet<string> {
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

export function findHatsDir(): string | undefined {
	return findSpriteKindDir('hats');
}

export function scanHatIds(dir = findHatsDir()): ReadonlySet<string> {
	return scanSpriteIds(dir);
}

// Mirrors findHatsDir/scanHatIds for Forms (sprites/forms/*.sprite). Scans that
// directory for `.sprite` ids (returns an empty set — never throws — if it is
// missing), so any form id not in the set sanitizes to the default Form. The
// default 'buddy' ships as sprites/forms/buddy.sprite.
export function findFormsDir(): string | undefined {
	return findSpriteKindDir('forms');
}

export function scanFormIds(dir = findFormsDir()): ReadonlySet<string> {
	return scanSpriteIds(dir);
}
