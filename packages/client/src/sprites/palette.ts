// State-driven tints (hurt flash, dimming, telegraphs) live in the renderer,
// not here, because they depend on per-entity state this static layer can't see.
// The art colour DATA is the shared SCENE_PALETTE (one source of truth with the
// forge preview, #56); here we just bind it to opentui RGBA.
import { SCENE_PALETTE } from '@mmo/shared';
import { RGBA } from '@opentui/core';

export const PALETTE: Record<string, RGBA> = Object.fromEntries(
	Object.entries(SCENE_PALETTE).map(([k, [r, g, b, a]]) => [
		k,
		RGBA.fromInts(r, g, b, a),
	]),
);
