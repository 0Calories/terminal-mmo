// Screen/chrome colours — distinct from sprites/palette.ts, the recolourable
// *art* palette keyed by single-char codes.
import { RGBA } from '@opentui/core';

export const COLORS = {
	bg: RGBA.fromInts(16, 18, 26, 255),
	terrainFg: RGBA.fromInts(70, 82, 104, 255),
	terrainBg: RGBA.fromInts(34, 40, 54, 255),
	transparent: RGBA.fromInts(0, 0, 0, 0),
	hurt: RGBA.fromInts(255, 240, 120, 255),
	melee: RGBA.fromInts(255, 245, 200, 255),
	projectile: RGBA.fromInts(255, 120, 80, 255),
	portal: RGBA.fromInts(180, 130, 255, 255),
	vendor: RGBA.fromInts(255, 200, 90, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
	chat: RGBA.fromInts(120, 200, 235, 255),
	// Over-head Speech bubble (#59, ADR 0007): opaque fill so terrain can't bleed
	// through, a dim border + tail, and bright text.
	bubbleFg: RGBA.fromInts(236, 236, 242, 255),
	bubbleBorder: RGBA.fromInts(120, 200, 235, 255),
	bubbleBg: RGBA.fromInts(20, 24, 34, 255),
	// Over-head emote glyph (#38): a bright, high-contrast reaction on the telegraph
	// layer, drawn above all Sprites and self-clearing.
	emote: RGBA.fromInts(255, 220, 110, 255),
};
