// zones — the place: zone types, the .zone text format, forge-only validation,
// zone state, and the slim authoritative tick. The whole (registry, instances,
// portals, sessions) lives in world/.

export {
	GROUND_TOP,
	NPC_BOX,
	PORTAL_BOX,
	RESPAWN,
	SPAWN,
	WORLD,
	ZONE_MAX,
} from './constants';
export type { Portal, Zone, ZoneId, ZoneType } from './types';
export {
	type AvatarIntent,
	clientStepAvatar,
	createZoneState,
	type ServerAvatar,
	stepZone,
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
