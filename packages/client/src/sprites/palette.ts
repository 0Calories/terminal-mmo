// Base art colours, keyed by the single-char codes used in sprite colour grids
// (and each sprite's `defaultKey`). This is the swappable layer ADR 0003 calls
// "region-recolor": same art, different palette. State-driven tints (hurt flash,
// dimming of overlapped others, combat telegraphs) are NOT here — those depend
// on entity state, so they live in the renderer.
import { RGBA } from '@opentui/core';

export const PALETTE: Record<string, RGBA> = {
	p: RGBA.fromInts(255, 150, 40, 255), // player body (orange)
	m: RGBA.fromInts(220, 90, 90, 255), // monster body (red)
	// Accent / region keys used by the candidate designs in gallery.ts. Harmless
	// to the live sprites (which only reference p/m); kept here so the gallery
	// renders through the real palette and any design that ships is wired up.
	e: RGBA.fromInts(150, 235, 255, 255), // eyes / cool accent (cyan)
	g: RGBA.fromInts(170, 240, 95, 255), // monster eye-glow (toxic green)
	u: RGBA.fromInts(168, 120, 225, 255), // shooter body (violet)
	a: RGBA.fromInts(255, 200, 80, 255), // shooter eye / charge (amber)
	s: RGBA.fromInts(255, 224, 181, 255), // skin / face (warm)
	i: RGBA.fromInts(150, 170, 190, 255), // iron / steel (armour)
	k: RGBA.fromInts(120, 40, 50, 255), // dark detail (claw / shadow)
};
