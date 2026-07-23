import { SCENE_COLORS } from '@mmo/core/entities';
import {
	type Cell,
	type Compositor,
	compositeOver,
	compositeOverInto,
	createCellOut,
	type RGBA as RGBA8,
} from '@mmo/render/compositor';
import { type OptimizedBuffer, RGBA } from '@opentui/core';

/** The sky backdrop painted wherever the composed surface stays transparent. */
const SCENE_BG: RGBA8 = SCENE_COLORS.bg;

/**
 * Forge-local OpenTUI encode adapter (mirrors the client's `encodeToBuffer`;
 * Forge cannot import `@mmo/client`). It copies a composed sub-cell surface into
 * OpenTUI exactly once — the single seam where Forge render output reaches
 * OpenTUI. Reads through the compositor's allocation-light path so a frame
 * encode allocates no per-cell intermediates. Translucent glyph foregrounds
 * flatten onto their composed backdrop so alpha survives OpenTUI's opaque
 * `setCell`.
 */
export function encodeToBuffer(
	compositor: Compositor,
	buffer: OptimizedBuffer,
): void {
	const out = createCellOut();
	for (let y = 0; y < compositor.heightCells; y++) {
		for (let x = 0; x < compositor.widthCells; x++) {
			compositor.readCellInto(x, y, out);
			// Flatten a transparent or translucent bg onto the sky, then fg over bg,
			// both in place; `out` is fresh scratch each cell.
			if (out.bg[3] !== 255) compositeOverInto(out.bg, SCENE_BG, out.bg);
			compositeOverInto(out.fg, out.bg, out.fg);
			// A wide grapheme's lead cell emits the two-column glyph; its
			// continuation cell is already covered by that glyph, so blank it and
			// let the terminal's width advance own the neighbour.
			const char = out.wide === 'cont' ? ' ' : out.char;
			buffer.setCell(
				x,
				y,
				char,
				RGBA.fromInts(out.fg[0], out.fg[1], out.fg[2], 255),
				RGBA.fromInts(out.bg[0], out.bg[1], out.bg[2], 255),
			);
		}
	}
}

/**
 * Copy a composed surface through a cell sink, flattening every cell onto the
 * sky backdrop so transparent quadrants read as the scene bg (matching the live
 * client). The sink writes opaque OpenTUI cells at the surface's own origin.
 * Used where the source is a materialized `Cell[][]` rather than a live
 * compositor (e.g. the sprite editor).
 */
export function encodeSurface(
	rows: readonly (readonly Cell[])[],
	set: (x: number, y: number, ch: string, fg: RGBA, bg: RGBA) => void,
): void {
	for (let y = 0; y < rows.length; y++) {
		const row = rows[y];
		for (let x = 0; x < row.length; x++) {
			const cell = row[x];
			const bg =
				cell.bg[3] === 255 ? cell.bg : compositeOver(cell.bg, SCENE_BG);
			const fg = compositeOver(cell.fg, bg);
			// A wide grapheme's lead cell emits the two-column glyph; its
			// continuation cell is already covered by that glyph, so blank it and
			// let the terminal's width advance own the neighbour.
			const char = cell.wide === 'cont' ? ' ' : cell.char;
			set(
				x,
				y,
				char,
				RGBA.fromInts(fg[0], fg[1], fg[2], 255),
				RGBA.fromInts(bg[0], bg[1], bg[2], 255),
			);
		}
	}
}
