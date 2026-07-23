import type { Compositor, RGBA } from '@mmo/render/compositor';
import { speckColor, speckGlyph } from './engine';
import type { Speck } from './profile';

/**
 * Compose the matching specks natively into the shared {@link Compositor}
 * (ADR 0038). Each speck's on-screen origin comes from quantizing the combined
 * world-relative transform once — `round((world - cam) * scale)`, never rounding
 * camera and speck apart — the discipline actors and terrain share (#451), so
 * particles never shimmer against them.
 *
 * `pixel` specks follow their half-cell position on both axes (2 Pixels per
 * cell) and source-over a translucent sub-cell Pixel, so the composed scene
 * shows through. A settled speck rests at `y = surfaceRow - eps`, so `round(y *
 * 2)` lands on the surface's top Pixel: the terrain-contact rest, kept at
 * half-cell. `glyph` specks snap to the nearest cell and stamp a character,
 * deriving their backdrop from the scene beneath.
 */
export function drawSpecks(
	compositor: Compositor,
	specks: Iterable<Speck>,
	cam: { x: number; y: number },
	keep: (p: Speck) => boolean,
): void {
	const sw = compositor.widthCells;
	const sh = compositor.heightCells;
	for (const p of specks) {
		if (!p.active || !keep(p)) continue;
		const c = speckColor(p);
		const color: RGBA = [c.r, c.g, c.b, c.a];
		if (p.profile.primitive === 'pixel') {
			const px = Math.round((p.x - cam.x) * 2);
			const py = Math.round((p.y - cam.y) * 2);
			if (px < 0 || px >= sw * 2 || py < 0 || py >= sh * 2) continue;
			compositor.setPixel(px, py, color);
		} else {
			const col = Math.round(p.x - cam.x);
			const row = Math.round(p.y - cam.y);
			if (col < 0 || col >= sw || row < 0 || row >= sh) continue;
			compositor.stampGlyph(col, row, speckGlyph(p), color);
		}
	}
}
