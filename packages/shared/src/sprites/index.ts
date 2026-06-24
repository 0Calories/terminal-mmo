import type { EntityType, Npc } from '../types';
import { chaser } from './chaser';
import { merchant } from './merchant';
import { player } from './player';
import { shooter } from './shooter';
import type { Sprite } from './sprite';

// `Record<EntityType, …>` forces every entity type to have art at compile time.
const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

// NPCs aren't entities (not simulated), so they key off their own `kind`.
const NPC_REGISTRY: Record<Npc['kind'], Sprite> = {
	vendor: merchant,
};

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return NPC_REGISTRY[kind];
}

export {
	type BodySprite,
	type BodyState,
	bodyFrame,
	DEFAULT_FORM,
	EMOTE_FPS,
	type EmotePoseId,
	FORMS,
	formById,
	formFrame,
	mirrorAnchorX,
	type PoseId,
	STRIDE,
} from './body-sprite';
export { HATS, type HatDef } from './hats';
// The art palette is keyed by single-char codes but its colours are renderer-
// specific (opentui RGBA), so it stays with the consumer; shared owns only the
// framework-agnostic glyph/colour-key grids.
export { mirrorGlyph, SENTINEL, Sprite } from './sprite';
export {
	WEAPON_ACCENT_KEY,
	type WeaponFrameId,
	type WeaponSprite,
} from './weapon-sprite';
export { sword } from './weapons/sword';
