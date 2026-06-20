// Shared UI colour palette for the client's rendering layer (ADR 0005). These
// are screen/chrome colours used by the playfield draw code and the HUD
// renderables — distinct from sprites/palette.ts, which holds the recolourable
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
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
};
