// @mmo/assets — the single home for zone and sprite content (ADR 0033): the
// file trees, their discovery, and their identity. One store, two doors: this
// full door (client, render, forge) exposes raw sprite sources and the zone
// read-side; `@mmo/assets/meta` is the ids/roles/zone-list subset the server
// is allowed (and depcruise-restricted) to import.
export { loadZones, spriteIds } from './meta';
export {
	loadSpriteSources,
	readSpriteSourcesFromDir,
	type SpriteSource,
	spriteSourcesFromEntries,
} from './sprites';
export { type AssetEntries, loadAssetEntries } from './store';
export {
	catalogsFromEntries,
	type LoadedZone,
	listZoneIds,
	loadCatalogs,
	loadZone,
	loadZoneSet,
	zonePath,
	zonesFromEntries,
} from './zones';
