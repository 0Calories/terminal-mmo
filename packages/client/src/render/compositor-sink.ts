import { SCENE_COLORS } from '@mmo/core/entities';
import {
	type Compositor,
	compositeOverInto,
	createCellOut,
	type RGBA as RGBA8,
} from '@mmo/render/compositor';
import { type OptimizedBuffer, RGBA } from '@opentui/core';

/** The sky backdrop the encoder paints wherever the surface stays transparent. */
const SCENE_BG: RGBA8 = SCENE_COLORS.bg;

/**
 * Encode the composed surface into OpenTUI exactly once per frame: the single
 * seam where render output reaches OpenTUI. Translucent glyph foregrounds
 * flatten onto their composed backdrop so alpha survives OpenTUI's opaque
 * `setCell`. Reads through the compositor's allocation-light path — one reused
 * `CellOut` decodes the whole surface, so a frame encode allocates no per-cell
 * intermediates (only OpenTUI's own `RGBA` colours remain).
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
