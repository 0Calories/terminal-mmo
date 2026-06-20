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
};
