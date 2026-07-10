// @mmo/core owns sprite *metadata* + *pose selection* only — the art-free, deterministic
// half the sim (and the server) reasons about. The Sprite class, glyph grids, form/hat/
// weapon art, and the drawing code live in @mmo/render.

export { type SpriteMeta, spriteMetaFor } from './meta';
export {
	type BodyState,
	bodyFrame,
	EMOTE_FPS,
	type EmotePoseId,
	mirrorAnchorX,
	type PoseId,
	STRIDE,
	type WeaponFrameId,
} from './pose';
