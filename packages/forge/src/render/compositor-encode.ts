import { SCENE_COLORS } from '@mmo/core/entities';
import {
	type Cell,
	type Compositor,
	compositeOver,
	type RGBA as RGBA8,
} from '@mmo/render/compositor';
import { type OptimizedBuffer, RGBA } from '@opentui/core';

/** The sky backdrop painted wherever the composed surface stays transparent. */
const SCENE_BG: RGBA8 = SCENE_COLORS.bg;

/**
 * Forge-local OpenTUI encode adapter (mirrors the client's `encodeToBuffer`;
 * Forge cannot import `@mmo/client`). It copies a composed sub-cell surface into
 * OpenTUI exactly once — the single seam where Forge render output reaches
 * OpenTUI. Translucent glyph foregrounds flatten onto their composed backdrop so
 * alpha survives OpenTUI's opaque `setCell`.
 */
export function encodeToBuffer(
	compositor: Compositor,
	buffer: OptimizedBuffer,
): void {
	encodeSurface(compositor.surface(), (x, y, ch, fg, bg) =>
		buffer.setCell(x, y, ch, fg, bg),
	);
}

/**
 * Copy a composed surface through a cell sink, flattening every cell onto the
 * sky backdrop so transparent quadrants read as the scene bg (matching the live
 * client). The sink writes opaque OpenTUI cells at the surface's own origin.
 */
export function encodeSurface(
	rows: readonly (readonly Cell[])[],
	set: (x: number, y: number, ch: string, fg: RGBA, bg: RGBA) => void,
): void {
	for (let y = 0; y < rows.length; y++) {
		const row = rows[y];
		for (let x = 0; x < row.length; x++) {
			const cell = row[x];
			const bg = cell.bg[3] > 0 ? cell.bg : SCENE_BG;
			const fg = compositeOver(cell.fg, bg);
			set(
				x,
				y,
				cell.char,
				RGBA.fromInts(fg[0], fg[1], fg[2], 255),
				RGBA.fromInts(bg[0], bg[1], bg[2], 255),
			);
		}
	}
}
