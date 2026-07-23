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
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);

	for (let sy = 0; sy < sh; sy++) {
		const wy = sy + camY;
		for (let sx = 0; sx < sw; sx++) {
			const wx = sx + camX;
			if (
				!isSolid(terrain, wx, wy) ||
				wx < 0 ||
				wx >= terrain.w ||
				wy < 0 ||
				wy >= terrain.h
			)
				continue;
			const px = sx * 2;
			const py = sy * 2;
			// Surface cell: only the bottom half is ground; the top stays transparent.
			if (!isSolid(terrain, wx, wy - 1))
				compositor.fillPixelRect(px, py + 1, 2, 1, TERRAIN);
			else compositor.fillPixelRect(px, py, 2, 2, TERRAIN);
		}
	}
}
