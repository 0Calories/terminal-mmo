import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { classifyPath, contractHash, contractRoots } from '@mmo/core/release';

import type { AssetEntries } from './store';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function readRoot(dir: string, prefix: string, out: Record<string, string>) {
	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true }) as string[];
	} catch {
		return;
	}
	for (const entry of entries) {
		const rel = entry.split(sep).join('/');
		if (rel.split('/').some((part) => SKIP_DIRS.has(part))) continue;
		const path = `${prefix}${rel}`;
		const kind = classifyPath(path);
		if (kind !== 'contract' && !path.startsWith('sprites/')) continue;
		const full = join(dir, entry);
		try {
			if (!statSync(full).isFile()) continue;
			out[path] = readFileSync(full, 'utf8');
		} catch {}
	}
}

// Reads every file the contract hash is computed over, from a repo checkout or
// the server image (which ships the repo). Walk roots come from the manifest
// itself so enumeration can never drift from classification.
export function loadContractEntries(
	rootDir: string = process.cwd(),
): AssetEntries {
	const { prefixes, files } = contractRoots();
	const out: Record<string, string> = {};
	for (const prefix of prefixes) {
		readRoot(join(rootDir, prefix), prefix, out);
	}
	for (const file of files) {
		try {
			out[file] = readFileSync(join(rootDir, file), 'utf8');
		} catch {}
	}
	return out;
}

export function computeContractHash(rootDir?: string): string {
	return contractHash(loadContractEntries(rootDir));
}
