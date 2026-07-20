// @mmo/render — presentation: the Sprite class, glyph-grid art (forms, hats, weapons,
// monsters), and the `render.ts` drawing code. Depends on @mmo/core (sim + sprite
// metadata); depended on by client + forge, never the server.
export { type BodySprite, formFrame, walkFrameCount } from './body-sprite';
export { buildFormRegistry, FORM_IDS, formById } from './forms';
export { buildHatRegistry, HAT_IDS, hatById } from './hats';
export {
	glyphFromQuadrants,
	QUADRANT_GLYPHS,
	quadrantsFromGlyph,
} from './quadrant';
export {
	buildMonsterRegistry,
	buildNpcRegistry,
	buildSpriteRegistry,
	MONSTER_SPRITE_IDS,
	NPC_SPRITE_IDS,
	spriteFor,
	spriteForNpc,
} from './registry';
export {
	type CellBuffer,
	drawEntitySprite,
	drawNameplates,
	drawNpcSprite,
	type GhostStyle,
	type RenderStyle,
	renderZoneScene,
	type SpriteOverrides,
	type ZoneScene,
} from './render';
export { buildSceneStyle, type ColorFactory } from './scene-style';
export { mirrorGlyph, SENTINEL, Sprite } from './sprite';
export {
	compileBodySprite,
	compileWeaponSprite,
	spriteFromDoc,
} from './sprite-compile';
export {
	parseSpriteFile,
	type SpriteAnchor,
	type SpriteDiagnostic,
	type SpriteDoc,
	type SpriteFrameDoc,
	type SpriteSeverity,
	serializeSpriteFile,
} from './sprite-file';
export {
	ROLE_PROFILES,
	validateSpriteRole,
	validateSpriteSet,
} from './sprite-validate';
export {
	buildWeaponRegistry,
	WEAPON_SPRITE_IDS,
	weaponSpriteById,
} from './weapon-registry';
export { WEAPON_ACCENT_KEY, type WeaponSprite } from './weapon-sprite';
