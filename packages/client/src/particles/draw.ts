import type { Terrain } from '@mmo/core/entities';
import type { Compositor, RGBA } from '@mmo/render/compositor';
import { speckColor, speckDrawCell, speckGlyph } from './engine';
import type { Speck } from './profile';

/**
 * Compose the matching specks natively into the shared {@link Compositor}
 * (ADR 0038). `pixel` profiles source-over a translucent sub-cell Pixel at the
 * cell's Pixel origin — half-cell placement is issue #453 — so the composed
 * scene shows through. `glyph` profiles stamp their character snapped to the
 * cell, deriving the backdrop from the scene beneath. Alpha and backdrop are the
 * compositor's, not OpenTUI's.
 */
export function drawSpecks(
	compositor: Compositor,
	specks: Iterable<Speck>,
	cam: { x: number; y: number },
	terrain: Terrain,
	keep: (p: Speck) => boolean,
): void {
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const sw = compositor.widthCells;
	const sh = compositor.heightCells;
	for (const p of specks) {
		if (!p.active || !keep(p)) continue;
		const { col, row } = speckDrawCell(p, terrain);
		const px = col - camX;
		const py = row - camY;
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const c = speckColor(p);
		const color: RGBA = [c.r, c.g, c.b, c.a];
		if (p.profile.primitive === 'pixel') {
			compositor.setPixel(px * 2, py * 2, color);
		} else {
			compositor.stampGlyph(px, py, speckGlyph(p), color);
		}
	}
}
