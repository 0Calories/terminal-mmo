// entities — the flat Entity record, per-kind archetype tuning, player spawning,
// cosmetics identity, emotes, and the shared palette/hue tables.

export {
	BOX,
	BRUTE,
	MONSTER,
	SHOOTER,
} from './archetypes';
export {
	clampCosmetics,
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	HUE_COUNT,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
	NAMEPLATE_COUNT,
	randomCosmetics,
	sanitizeFormId,
	sanitizeHatId,
} from './cosmetics';
export {
	EMOTES,
	type EmoteDef,
	type EmoteLifetime,
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from './emote';
export {
	type PlayerState,
	spawnAvatar,
	spawnPlayerState,
} from './player';
export {
	darken,
	HUES,
	NAMEPLATE_BG_DARKEN,
	NAMEPLATE_COLORS,
	type RGBAQuad,
	SCENE_COLORS,
	SCENE_PALETTE,
} from './sceneStyle';
export type {
	ActionState,
	AttackPhase,
	Box,
	Control,
	Cosmetics,
	Drop,
	Entity,
	EntityType,
	Facing,
	Faction,
	Input,
	Item,
	ItemAffix,
	MoveId,
	Npc,
	PendingRespawn,
	PlayerProgress,
	Projectile,
	Rarity,
	Slot,
	SpawnPoint,
	Strike,
	Terrain,
	Tint,
} from './types';
