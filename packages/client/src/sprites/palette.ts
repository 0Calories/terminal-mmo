// Base art colours, keyed by the single-char codes used in sprite colour grids
// (and each sprite's `defaultKey`). This is the swappable layer ADR 0003 calls
// "region-recolor": same art, different palette. State-driven tints (hurt flash,
// dimming of overlapped others, combat telegraphs) are NOT here — those depend
// on entity state, so they live in the renderer.
import { RGBA } from '@opentui/core';

export const PALETTE: Record<string, RGBA> = {
	p: RGBA.fromInts(255, 150, 40, 255), // player body (orange)
	m: RGBA.fromInts(220, 90, 90, 255), // monster body (red)
	g: RGBA.fromInts(170, 240, 95, 255), // monster eye-glow (toxic green)
	// Extended base-art palette: region-recolour options for the candidate
	// Avatars/Monsters in the design gallery (ADR 0003). Not all are wired into
	// live entities yet — they exist so proposals render true-to-game.
	s: RGBA.fromInts(186, 196, 210, 255), // steel / stone silver
	w: RGBA.fromInts(150, 96, 52, 255), // wood / mushroom gills brown
	y: RGBA.fromInts(242, 210, 92, 255), // gold / glow yellow
	e: RGBA.fromInts(236, 190, 150, 255), // skin / tan
	f: RGBA.fromInts(110, 200, 110, 255), // foliage / slime green
	c: RGBA.fromInts(132, 222, 230, 255), // ice / cyan
	o: RGBA.fromInts(232, 230, 216, 255), // bone / off-white
	k: RGBA.fromInts(64, 66, 82, 255), // shadow / eye-socket dark
};
