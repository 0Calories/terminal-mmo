// The one asset store (ADR 0033): every zone and sprite the game ships reaches
// the process through `loadAssetEntries`, via one of two strategies. In dev the
// repo-root `sprites/` and `zones/` trees are re-read from disk on every call,
// so the forge editors' write → re-read loop (and any hand edit) is picked up
// without a rebuild. In a compiled binary the bundler defines
// `MMO_EMBEDDED_ASSETS` (packages/cli/build.ts) and no asset directory is
// needed at runtime.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

declare const MMO_EMBEDDED_ASSETS: Record<string, string>;

// Keys are repo-root-relative POSIX paths with their extension kept —
// 'sprites/hats/cap.sprite', 'zones/town-01.zone', 'zones/catalogs.json' —
// so both strategies (and the builder that embeds them) speak one format.
export type AssetEntries = Record<string, string>;

const ASSET_TREES = [
	{ name: 'sprites', exts: ['.sprite'] },
	{ name: 'zones', exts: ['.zone', '.json'] },
] as const;

// Try process.cwd() first (the Docker image and dev scripts run from the repo
// root), then walk up from this file's directory a few levels so the tree is
// still found when the process starts elsewhere (e.g. under a test runner).
function findAssetDir(name: string): string | undefined {
	const cwdCandidate = join(process.cwd(), name);
	if (existsSync(cwdCandidate)) return cwdCandidate;

	let current = import.meta.dir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(current, name);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return undefined;
}

function readTree(
	dir: string,
	name: string,
	exts: readonly string[],
	out: AssetEntries,
): void {
	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true }) as string[];
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!exts.some((ext) => entry.endsWith(ext))) continue;
		let text: string;
		try {
			text = readFileSync(join(dir, entry), 'utf8');
		} catch {
			continue;
		}
		out[`${name}/${entry.split(sep).join('/')}`] = text;
	}
}

export function loadAssetEntries(): AssetEntries {
	if (typeof MMO_EMBEDDED_ASSETS !== 'undefined') return MMO_EMBEDDED_ASSETS;

	const out: AssetEntries = {};
	for (const { name, exts } of ASSET_TREES) {
		const dir = findAssetDir(name);
		if (dir) readTree(dir, name, exts, out);
	}
	return out;
}
