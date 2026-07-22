import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

declare const MMO_EMBEDDED_ASSETS: Record<string, string>;

export type AssetEntries = Record<string, string>;

export const SPRITE_EXT = '.sprite';

export function entryId(key: string, ext: string): string {
	const last = key.slice(key.lastIndexOf('/') + 1);
	return last.slice(0, -ext.length);
}

const ASSET_TREES = [
	{ name: 'sprites', exts: ['.sprite'] },
	{ name: 'zones', exts: ['.zone', '.json'] },
] as const;

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
