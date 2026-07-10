// world — the whole: the multi-session server world (zone registry, Dungeon
// instances, Party keying, portal transitions, death relocation), session
// placement, and the synthetic local session that drives it single-player.

export { TOWN_SPAWN } from './constants';
export {
	createLocalWorld,
	type LocalWorld,
	localAvatar,
	localZoneState,
	stepLocalWorld,
} from './localSession';
export {
	addSession,
	avatarBox,
	createServerWorld,
	handleOf,
	joinParty,
	removeSession,
	type ServerWorld,
	sessionByHandle,
	sessionsInZone,
	spawnNewAvatar,
	stepServerWorld,
	updateAvatar,
	worldSnapshotFor,
	zoneInstance,
	zoneOf,
	zoneStateOf,
} from './serverWorld';
export {
	addAvatar,
	removeAvatar,
	snapshotFor,
	withCosmetics,
} from './session';
