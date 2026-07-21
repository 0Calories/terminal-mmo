// entities — the flat Entity record and its per-kind factories, one archetype
// profile per Monster kind, Npc placements, cosmetics identity, emotes, and
// the shared palette/hue tables.

export {
	ARCHETYPES,
	type ArchetypeProfile,
	BOX,
	type MeleeProfile,
	meleeProfileOf,
	type ProjectileSpec,
	type RangedProfile,
	rangedProfileOf,
} from './archetypes';
export {
	BRAINS,
	type Brain,
	type BrainResult,
	type BrainView,
	type ShooterState,
} from './brain';
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
	type EmoteId,
	type EmoteLifetime,
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from './emote';
export {
	type AvatarOptions,
	spawnAvatar,
	spawnMonster,
} from './factory';
export type { Npc } from './npc';
export {
	darken,
	HUES,
	NAMEPLATE_BG_DARKEN,
	NAMEPLATE_COLORS,
	type RGBAQuad,
	SCENE_COLORS,
	SCENE_PALETTE,
	STANDARD_PALETTE,
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
	MonsterType,
	MoveId,
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
