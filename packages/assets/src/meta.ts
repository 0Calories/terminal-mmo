import {
	type AssetEntries,
	entryId,
	loadAssetEntries,
	SPRITE_EXT,
} from './store';

export { loadZones } from './zones';

export function spriteIds(
	role: string,
	entries: AssetEntries = loadAssetEntries(),
): ReadonlySet<string> {
	const prefix = `sprites/${role}/`;
	const ids = new Set<string>();
	for (const key of Object.keys(entries)) {
		if (!key.startsWith(prefix) || !key.endsWith(SPRITE_EXT)) continue;
		ids.add(entryId(key, SPRITE_EXT));
	}
	return ids;
}
