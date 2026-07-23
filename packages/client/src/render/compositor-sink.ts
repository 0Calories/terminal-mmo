import { SCENE_COLORS } from '@mmo/core/entities';
import {
	type Compositor,
	compositeOver,
	type RGBA as RGBA8,
} from '@mmo/render/compositor';
import { type OptimizedBuffer, RGBA } from '@opentui/core';

/** The sky backdrop the encoder paints wherever the surface stays transparent. */
const SCENE_BG: RGBA8 = SCENE_COLORS.bg;

/**
 * Encode the composed surface into OpenTUI exactly once per frame: the single
 * seam where render output reaches OpenTUI. Translucent glyph foregrounds
 * flatten onto their composed backdrop so alpha survives OpenTUI's opaque
 * `setCell`.
 */
export function encodeToBuffer(
	compositor: Compositor,
	buffer: OptimizedBuffer,
): void {
	const rows = compositor.surface();
	for (let y = 0; y < rows.length; y++) {
		const row = rows[y];
		for (let x = 0; x < row.length; x++) {
			const cell = row[x];
			const bg = cell.bg[3] > 0 ? cell.bg : SCENE_BG;
			const fg = compositeOver(cell.fg, bg);
			buffer.setCell(
				x,
				y,
				cell.char,
				RGBA.fromInts(fg[0], fg[1], fg[2], 255),
				RGBA.fromInts(bg[0], bg[1], bg[2], 255),
			);
		}
	}
}
