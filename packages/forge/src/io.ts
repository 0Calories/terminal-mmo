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
		return { id, zone: parseZone(text, catalogs, id), text };
	} catch (e) {
		return { id, parseError: (e as Error).message, text };
	}
}

/** Every `.zone` id in the dir (sorted), without parsing — the bare identity list. */
export function listZoneIds(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((f) => f.endsWith(ZONE_EXT))
		.map((f) => f.slice(0, -ZONE_EXT.length))
		.sort();
}

/** Every `.zone` in the dir, parsed (id-sorted for deterministic output). */
export function loadZoneSet(root: string, catalogs: Catalogs): LoadedZone[] {
	return listZoneIds(root).map((id) => loadZone(root, id, catalogs));
}

export function zonePath(root: string, id: string): string {
	return join(root, `${id}${ZONE_EXT}`);
}

export function zoneExists(root: string, id: string): boolean {
	return existsSync(zonePath(root, id));
}

/** Write raw `.zone` text to `<root>/<id>.zone` — symmetric with `loadZone`. The
 *  editor (#84) serializes an `EditorDoc` and writes the result here. */
export function writeZone(root: string, id: string, text: string): void {
	writeFileSync(zonePath(root, id), text);
}

/** Move `<root>/<old>.zone` → `<root>/<new>.zone`. The id is the filename
 *  (ADR 0011), so renaming a Zone is renaming its file. */
export function renameZoneFile(
	root: string,
	oldId: string,
	newId: string,
): void {
	renameSync(zonePath(root, oldId), zonePath(root, newId));
}

/**
 * Rewrite every Portal `target` in one `.zone` file's header that references
 * `oldId`, so a rename of a Zone keeps the cross-zone links intact (ADR 0011).
 * Pure + surgical: only whole-value `"target": "<oldId>"` matches in the HEADER
 * are touched (the grid body is left alone), so the resulting diff is minimal and
 * the rest of the file — formatting, other targets, unrelated keys — is byte-stable.
 */
export function rewritePortalTarget(
	text: string,
	oldId: string,
	newId: string,
): string {
	const lines = text.split('\n');
	const di = lines.findIndex((l) => l.trim() === '---');
	if (di === -1) return text;
	const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`("target"\\s*:\\s*)"${esc}"`, 'g');
	const header = lines.slice(0, di).join('\n').replace(re, `$1"${newId}"`);
	return [header, ...lines.slice(di)].join('\n');
}
