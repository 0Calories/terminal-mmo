import { SCENE_PALETTE } from '@mmo/core';
import { RGBA } from '@opentui/core';

export const PALETTE: Record<string, RGBA> = Object.fromEntries(
	Object.entries(SCENE_PALETTE).map(([k, [r, g, b, a]]) => [
		k,
		RGBA.fromInts(r, g, b, a),
	]),
);
