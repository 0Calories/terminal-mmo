// State-driven tints (hurt flash, dimming, telegraphs) live in the renderer,
// not here, because they depend on per-entity state this static layer can't see.
import { RGBA } from '@opentui/core';

export const PALETTE: Record<string, RGBA> = {
	p: RGBA.fromInts(255, 150, 40, 255),
	m: RGBA.fromInts(220, 90, 90, 255),
	g: RGBA.fromInts(170, 240, 95, 255),
	s: RGBA.fromInts(186, 196, 210, 255),
	w: RGBA.fromInts(150, 96, 52, 255),
	y: RGBA.fromInts(242, 210, 92, 255),
	e: RGBA.fromInts(236, 190, 150, 255),
	f: RGBA.fromInts(110, 200, 110, 255),
	c: RGBA.fromInts(132, 222, 230, 255),
	o: RGBA.fromInts(232, 230, 216, 255),
	k: RGBA.fromInts(64, 66, 82, 255),
};
