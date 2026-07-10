// zones — authoritative zone stepping, the .zone text format, and zone validation.

export { ZONE_MAX } from './constants';
export {
	type AvatarIntent,
	addAvatar,
	clientStepAvatar,
	createZoneState,
	removeAvatar,
	resolveDeaths,
	type ServerAvatar,
	snapshotFor,
	stepZone,
	withCosmetics,
	type ZoneState,
} from './zone';
export {
	type Catalogs,
	type MonsterCatalogEntry,
	type NpcCatalogEntry,
	parseZone,
	resolveMonster,
	resolveNpc,
	ZoneParseError,
} from './zoneFormat';
export {
	type Diagnostic,
	findOrphanGlyphs,
	type Severity,
	validateZone,
	validateZoneSet,
} from './zoneValidate';
