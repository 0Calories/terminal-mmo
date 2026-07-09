import type { EntityType, Npc } from '../types';
import { brute } from './brute';
import { chaser } from './chaser';
import { merchant } from './merchant';
import { player } from './player';
import { shooter } from './shooter';
import { signpost } from './signpost';
import type { Sprite } from './sprite';

const REGISTRY: Record<EntityType, Sprite> = {
	player,
	chaser,
	shooter,
	brute,
};

export function spriteFor(type: EntityType): Sprite {
	return REGISTRY[type];
}

const NPC_REGISTRY: Record<Npc['kind'], Sprite> = {
	vendor: merchant,
	signpost,
};

export function spriteForNpc(kind: Npc['kind']): Sprite {
	return NPC_REGISTRY[kind];
}

export {
	type BodySprite,
	type BodyState,
	bodyFrame,
	DEFAULT_FORM,
	DRAFTED_FORMS,
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
export { mirrorGlyph, SENTINEL, Sprite } from './sprite';
export {
	WEAPON_ACCENT_KEY,
	type WeaponFrameId,
	type WeaponSprite,
} from './weapon-sprite';
export { sword } from './weapons/sword';
