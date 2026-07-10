// Zones leave the assets package parsed (ADR 0033): ready to simulate. Assets
// depends on @mmo/core for the parser; core itself carries no fs or bundler
// knowledge — it is "given content, simulate".
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalogs, Zone } from '@mmo/core';
import { parseZone } from '@mmo/core';
import { type AssetEntries, entryId, loadAssetEntries } from './store';

const ZONE_EXT = '.zone';
const CATALOGS_FILE = 'catalogs.json';

function catalogsFromJson(raw: string | undefined): Catalogs {
	if (raw === undefined) return { monsters: [], npcs: [] };
	const parsed = JSON.parse(raw);
	return { monsters: parsed.monsters ?? [], npcs: parsed.npcs ?? [] };
}

export function catalogsFromEntries(entries: AssetEntries): Catalogs {
	return catalogsFromJson(entries[`zones/${CATALOGS_FILE}`]);
}

// Order matters downstream: the start Zone (a Town) is first — createGameFromZones
// callers and the client's fallback both spawn into loadZones()[0].
export function zonesFromEntries(entries: AssetEntries): Zone[] {
	const catalogs = catalogsFromEntries(entries);
	const zones = Object.keys(entries)
		.filter((k) => k.startsWith('zones/') && k.endsWith(ZONE_EXT))
		.sort()
		.map((key) => parseZone(entries[key], catalogs, entryId(key, ZONE_EXT)));
	return [
		...zones.filter((z) => z.type === 'town'),
		...zones.filter((z) => z.type !== 'town'),
	];
}

export function loadZones(): Zone[] {
	return zonesFromEntries(loadAssetEntries());
}

// With a root: read that directory's catalogs.json (the forge editing an
// explicit zone tree). Without: the shipped set, whichever strategy backs it.
export function loadCatalogs(root?: string): Catalogs {
	if (root === undefined) return catalogsFromEntries(loadAssetEntries());
	const path = join(root, CATALOGS_FILE);
	if (!existsSync(path)) return catalogsFromJson(undefined);
	return catalogsFromJson(readFileSync(path, 'utf8'));
}

// --- Explicit-root zone reading: the forge's write → re-read loop. Discovery
// and identity (id ⇄ filename) live here; writing stays in the forge.

export interface LoadedZone {
	id: string;
	zone?: Zone;
	parseError?: string;
	text?: string;
}

export function zonePath(root: string, id: string): string {
	return join(root, `${id}${ZONE_EXT}`);
}

export function listZoneIds(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((f) => f.endsWith(ZONE_EXT))
		.map((f) => f.slice(0, -ZONE_EXT.length))
		.sort();
}

export function loadZone(
	root: string,
	id: string,
	catalogs: Catalogs,
): LoadedZone {
	const path = zonePath(root, id);
	if (!existsSync(path)) return { id, parseError: `no such Zone '${id}'` };
	const text = readFileSync(path, 'utf8');
	try {
		return { id, zone: parseZone(text, catalogs, id), text };
	} catch (e) {
		return { id, parseError: (e as Error).message, text };
	}
}

export function loadZoneSet(root: string, catalogs: Catalogs): LoadedZone[] {
	return listZoneIds(root).map((id) => loadZone(root, id, catalogs));
}
