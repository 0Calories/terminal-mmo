import { RARITY_COLOR, type Rarity } from '@mmo/core';
import { RGBA } from '@opentui/core';

export const COLORS = {
	bg: RGBA.fromInts(16, 18, 26, 255),
	terrainFg: RGBA.fromInts(70, 82, 104, 255),
	terrainBg: RGBA.fromInts(34, 40, 54, 255),
	transparent: RGBA.fromInts(0, 0, 0, 0),
	hurt: RGBA.fromInts(255, 240, 120, 255),
	telegraph: RGBA.fromInts(255, 245, 200, 255),
	dodge: RGBA.fromInts(150, 220, 255, 255),
	guard: RGBA.fromInts(150, 200, 255, 255),
	projectile: RGBA.fromInts(255, 120, 80, 255),
	portal: RGBA.fromInts(180, 130, 255, 255),
	vendor: RGBA.fromInts(255, 200, 90, 255),
	signpost: RGBA.fromInts(214, 176, 120, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	xp: RGBA.fromInts(120, 170, 255, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
	warn: RGBA.fromInts(255, 120, 90, 255),
	chat: RGBA.fromInts(120, 200, 235, 255),
	// bubbleBg (behind-text) and bubbleShade (opaque ▒) must blend to the same tone over terrain.
	bubbleFg: RGBA.fromInts(236, 236, 242, 255),
	bubbleBorder: RGBA.fromInts(120, 200, 235, 255),
	bubbleBg: RGBA.fromInts(20, 24, 34, 128),
	bubbleShade: RGBA.fromInts(20, 24, 34, 255),
};

export const RARITY_RGBA: Record<Rarity, RGBA> = Object.fromEntries(
	(
		Object.entries(RARITY_COLOR) as [
			Rarity,
			{ r: number; g: number; b: number },
		][]
	).map(([rarity, c]) => [rarity, RGBA.fromInts(c.r, c.g, c.b, 255)]),
) as Record<Rarity, RGBA>;
