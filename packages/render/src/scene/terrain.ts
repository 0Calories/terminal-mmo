import { SCENE_COLORS, type Terrain } from '@mmo/core/entities';
import { isSolid } from '@mmo/core/physics';
import type { Compositor, RGBA } from '../compositor';

const TERRAIN: RGBA = SCENE_COLORS.terrainFg;

/**
 * Draw Terrain as the composed backdrop with sub-cell Pixels (ADR 0038, pass 1).
 * An interior cell fills all four quadrants; a surface cell fills only the two
 * bottom quadrants and leaves the top two transparent, so the sky backdrop shows
 * and planted sprites reveal the composed ground through their own transparent
 * quadrants (ADR 0021's `▄` surface, made composition-correct). Every write is
 * clipped by the compositor.
 */
export function drawTerrain(
	compositor: Compositor,
	terrain: Terrain,
	cam: { x: number; y: number },
): void {
	const sw = compositor.widthCells;
	const sh = compositor.heightCells;
	// Quantize the camera to Pixel resolution ONCE so Terrain shifts with the
	// half-cell camera and stays rigid relative to actors (ADR 0038). A world cell
	// wx maps to screen Pixel `wx * 2 - camPx`; the shared `camPx` keeps the whole
	// Terrain grid coherent instead of rounding each cell independently.
	const camPx = Math.round(cam.x * 2);
	const camPy = Math.round(cam.y * 2);
	const wx0 = Math.floor(camPx / 2) - 1;
	const wy0 = Math.floor(camPy / 2) - 1;

	for (let wy = wy0; wy <= wy0 + sh + 1; wy++) {
		if (wy < 0 || wy >= terrain.h) continue;
		const py = wy * 2 - camPy;
		for (let wx = wx0; wx <= wx0 + sw + 1; wx++) {
			if (wx < 0 || wx >= terrain.w || !isSolid(terrain, wx, wy)) continue;
			const px = wx * 2 - camPx;
			// Surface cell: only the bottom half is ground; the top stays transparent.
			if (!isSolid(terrain, wx, wy - 1))
				compositor.fillPixelRect(px, py + 1, 2, 1, TERRAIN);
			else compositor.fillPixelRect(px, py, 2, 2, TERRAIN);
		}
	}
}
