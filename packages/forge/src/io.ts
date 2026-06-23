import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Catalogs, Zone } from '@mmo/shared';
import { parseZone } from '@mmo/shared';

const ZONE_EXT = '.zone';
const CATALOGS_FILE = 'catalogs.json';

/** One `.zone` file off disk: parsed, or a parse-error message if malformed. */
export interface LoadedZone {
	id: string;
	zone?: Zone;
	parseError?: string;
	// Raw file text, kept so the CLI can run checks that need the original source
	// (e.g. orphan header glyphs, which parseZone discards). Absent if unreadable.
	text?: string;
}

/**
 * Load the shared catalog file from a zones dir. Absent file → empty catalogs
 * (a town/blank template needs none), so the CLI still works on a bare dir.
 */
export function loadCatalogs(root: string): Catalogs {
	const path = join(root, CATALOGS_FILE);
	if (!existsSync(path)) return { monsters: [], npcs: [] };
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	return { monsters: parsed.monsters ?? [], npcs: parsed.npcs ?? [] };
}

/** Parse one Zone by id; returns the parse error rather than throwing. */
export function loadZone(
	root: string,
	id: string,
	catalogs: Catalogs,
): LoadedZone {
	const path = join(root, `${id}${ZONE_EXT}`);
	if (!existsSync(path)) return { id, parseError: `no such Zone '${id}'` };
	const text = readFileSync(path, 'utf8');
	try {
		return { id, zone: parseZone(text, catalogs), text };
	} catch (e) {
		return { id, parseError: (e as Error).message, text };
	}
}

/** Every `.zone` in the dir, parsed (id-sorted for deterministic output). */
export function loadZoneSet(root: string, catalogs: Catalogs): LoadedZone[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((f) => f.endsWith(ZONE_EXT))
		.map((f) => f.slice(0, -ZONE_EXT.length))
		.sort()
		.map((id) => loadZone(root, id, catalogs));
}

export function zonePath(root: string, id: string): string {
	return join(root, `${id}${ZONE_EXT}`);
}

export function zoneExists(root: string, id: string): boolean {
	return existsSync(zonePath(root, id));
}

/** Write raw `.zone` text to `<root>/<id>.zone` — symmetric with `loadZone`. The
 *  editor (#84) serializes an `EditorDoc` and writes the result here. Atomic
 *  (#98): the bytes land in a sibling temp file first, then a single `rename`
 *  swaps it over the target — so a crash mid-write can never leave a half-written
 *  `.zone`, and no stray temp file survives a successful save. We lean on git for
 *  history (no `.bak`). */
export function writeZone(root: string, id: string, text: string): void {
	const target = zonePath(root, id);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, target);
}
