// @mmo/core owns sprite *metadata* + *animation selection* only — the art-free, deterministic
// half the sim (and the server) reasons about. The Sprite class, glyph grids, form/hat/
// weapon art, and the drawing code live in @mmo/render.

export {
	type AnimationId,
	type BodyState,
	bodyFrame,
	EMOTE_FPS,
	type EmoteAnimationId,
	mirrorAnchorX,
	STRIDE,
	swingFrameIndex,
} from './animation';
export {
	MONSTER_SPRITE_REF,
	monsterSpriteRef,
	NPC_SPRITE_REF,
	npcSpriteRef,
	type SpriteMeta,
	spriteMetaFor,
} from './meta';
