import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Catalogs, Zone } from '@mmo/core';
import { parseZone } from '@mmo/core';

const ZONE_EXT = '.zone';
const CATALOGS_FILE = 'catalogs.json';

export interface LoadedZone {
	id: string;
	zone?: Zone;
	parseError?: string;
	text?: string;
}

export function loadCatalogs(root: string): Catalogs {
	const path = join(root, CATALOGS_FILE);
	if (!existsSync(path)) return { monsters: [], npcs: [] };
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	return { monsters: parsed.monsters ?? [], npcs: parsed.npcs ?? [] };
}

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

export function listZoneIds(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((f) => f.endsWith(ZONE_EXT))
		.map((f) => f.slice(0, -ZONE_EXT.length))
		.sort();
}

export function loadZoneSet(root: string, catalogs: Catalogs): LoadedZone[] {
	return listZoneIds(root).map((id) => loadZone(root, id, catalogs));
}

export function zonePath(root: string, id: string): string {
	return join(root, `${id}${ZONE_EXT}`);
}

export function zoneExists(root: string, id: string): boolean {
	return existsSync(zonePath(root, id));
}

// Atomic write: temp file + rename, so a crash mid-write can't leave a half-written file.
export function writeZone(root: string, id: string, text: string): void {
	const target = zonePath(root, id);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, target);
}

export function renameZoneFile(
	root: string,
	oldId: string,
	newId: string,
): void {
	renameSync(zonePath(root, oldId), zonePath(root, newId));
}

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
