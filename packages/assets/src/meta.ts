// @mmo/assets/meta — the server's sole door (ADR 0033): asset identity (sprite
// ids per role) and the parsed Zone list. Sprite text stays behind the full
// door, so art data never flows into the sim; dependency-cruiser enforces that
// the server imports nothing else from this package.
import { type AssetEntries, loadAssetEntries } from './store';

export { loadZones } from './zones';

const SPRITE_EXT = '.sprite';

// Set-membership for cosmetic-id sanitization: a hat exists iff
// `sprites/hats/<id>.sprite` exists (likewise forms). `entries` is injectable
// so tests can prove the embedded strategy without a bundler.
export function spriteIds(
	role: string,
	entries: AssetEntries = loadAssetEntries(),
): ReadonlySet<string> {
	const prefix = `sprites/${role}/`;
	const ids = new Set<string>();
	for (const key of Object.keys(entries)) {
		if (!key.startsWith(prefix) || !key.endsWith(SPRITE_EXT)) continue;
		const last = key.slice(key.lastIndexOf('/') + 1);
		ids.add(last.slice(0, -SPRITE_EXT.length));
	}
	return ids;
}
