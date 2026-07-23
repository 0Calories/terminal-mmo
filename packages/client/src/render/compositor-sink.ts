import { SCENE_COLORS } from '@mmo/core/entities';
import type { CellBuffer } from '@mmo/render';
import {
	type Compositor,
	compositeOver,
	type RGBA as RGBA8,
} from '@mmo/render/compositor';
import { type OptimizedBuffer, RGBA } from '@opentui/core';

/** The sky backdrop the encoder paints wherever the surface stays transparent. */
const SCENE_BG: RGBA8 = SCENE_COLORS.bg;

function to8(c: RGBA): RGBA8 {
	const [r, g, b, a] = c.toInts();
	return [r, g, b, a];
}

/**
 * A {@link CellBuffer} shaped adapter backed by a {@link Compositor} so
 * not-yet-native producers (Terrain, portals, particles, labels, bubbles,
 * drops, dodge echoes, Projectiles) draw into the one composed surface instead
 * of straight to OpenTUI (ADR 0038). Opaque `setCell` stamps an authored
 * backdrop; alpha-blending stamps derive the backdrop from the composed
 * underlay — the "reveal the real scene" win — never a guessed background.
 */
export class CompositorSink implements CellBuffer<RGBA> {
	constructor(private readonly compositor: Compositor) {}

	get width(): number {
		return this.compositor.widthCells;
	}

	get height(): number {
		return this.compositor.heightCells;
	}

	clear(_bg: RGBA): void {
		// The scene bg is the encoder's transparent-cell fallback, not composited
		// pixels: filling here would turn every empty sky cell into a solid block
		// and would also become the derived backdrop for planted sprites.
		this.compositor.clear();
	}

	setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void {
		this.compositor.stampGlyph(x, y, ch, to8(fg), to8(bg));
	}

	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: RGBA,
		_bg: RGBA,
	): void {
		this.compositor.stampGlyph(x, y, ch, to8(fg));
	}
}

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
