// @mmo/render — presentation: the Sprite class, glyph-grid art (forms, hats, weapons,
// monsters), and the `render.ts` drawing code. Depends on @mmo/core (sim + sprite
// metadata); depended on by client + forge, never the server.
export {
	type BodySprite,
	DRAFTED_FORMS,
	FORMS,
	formById,
	formFrame,
} from './body-sprite';
export { HATS, type HatDef } from './hats';
export {
	glyphFromQuadrants,
	QUADRANT_GLYPHS,
	quadrantsFromGlyph,
} from './quadrant';
export { spriteFor, spriteForNpc } from './registry';
export {
	type CellBuffer,
	drawEntitySprite,
	drawNameplates,
	drawNpcSprite,
	type GhostStyle,
	type RenderStyle,
	renderZoneScene,
	type ZoneScene,
} from './render';
export { buildSceneStyle, type ColorFactory } from './scene-style';
export { mirrorGlyph, SENTINEL, Sprite } from './sprite';
export {
	parseSpriteFile,
	type SpriteAnchor,
	type SpriteDiagnostic,
	type SpriteDoc,
	type SpriteFrameDoc,
	type SpriteSeverity,
	serializeSpriteFile,
} from './sprite-file';
export { weaponSpriteById } from './weapon-registry';
export { WEAPON_ACCENT_KEY, type WeaponSprite } from './weapon-sprite';
export { sword } from './weapons/sword';
