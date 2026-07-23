import type { Facing } from '@mmo/core/entities';
import type { Compositor, RGBA } from '../compositor';
import type { CompiledSprite, SpritePalette } from './compile';

export interface PaintOptions {
	/**
	 * Top-left origin in sub-cell Pixels (2 Pixels per cell), placing the sprite at
	 * half-cell resolution on both axes (ADR 0038). Pixel primitives land at the
	 * exact Pixel; Glyph primitives snap to the nearest cell of this origin.
	 * Takes precedence over {@link cellX}/{@link cellY} when provided.
	 */
	readonly originPx?: number;
	readonly originPy?: number;
	/** Cell-aligned origin — equivalent to `originPx/originPy = cell * 2`. */
	readonly cellX?: number;
	readonly cellY?: number;
	readonly facing?: Facing;
	/** Scene palette resolved beneath the sprite's own doc palette. */
	readonly palette: SpritePalette;
	readonly paletteDefault: RGBA;
	/** Per-key overrides (hue, weapon accent, hurt); highest precedence. */
	readonly recolor?: SpritePalette;
	/**
	 * Paint every primitive in this one colour at its own alpha, ignoring the
	 * resolved palette — a flat silhouette for placement ghosts. A translucent
	 * tint composites source-over so the scene beneath reveals through it.
	 */
	readonly tint?: RGBA;
}

function resolve(
	key: string,
	sprite: CompiledSprite,
	opts: PaintOptions,
): RGBA {
	return (
		opts.recolor?.[key] ??
		sprite.palette[key] ??
		opts.palette[key] ??
		opts.paletteDefault
	);
}

/**
 * Paint a compiled Sprite frame into a Compositor at a Pixel origin (or cell
 * origin) and facing, resolving every colour KEY through the palettes and
 * optional recolor. Pixel primitives composite source-over at half-cell
 * resolution; Glyph stamps are atomic cells snapped to the nearest cell.
 */
export function paintSprite(
	compositor: Compositor,
	sprite: CompiledSprite,
	opts: PaintOptions,
): void {
	const facing = opts.facing ?? 1;
	const side = facing === 1 ? sprite.right : sprite.left;
	const originPx = opts.originPx ?? (opts.cellX ?? 0) * 2;
	const originPy = opts.originPy ?? (opts.cellY ?? 0) * 2;
	// Glyph primitives stay cell-snapped even at a half-cell Pixel origin: snap the
	// origin to its nearest cell so sprite stamps never land between cells.
	const glyphCellX = Math.round(originPx / 2);
	const glyphCellY = Math.round(originPy / 2);

	for (const p of side.pixels) {
		compositor.setPixel(
			originPx + p.px,
			originPy + p.py,
			opts.tint ?? resolve(p.key, sprite, opts),
		);
	}
	for (const g of side.glyphs) {
		const fg = opts.tint ?? resolve(g.fgKey, sprite, opts);
		// A tinted silhouette derives its backdrop from the composed scene so the
		// glyph reveals what it sits over; only untinted stamps keep an authored bg.
		const bg = opts.tint
			? undefined
			: g.bgKey !== undefined
				? resolve(g.bgKey, sprite, opts)
				: undefined;
		compositor.stampGlyph(
			glyphCellX + g.cellX,
			glyphCellY + g.cellY,
			g.char,
			fg,
			bg,
		);
	}
}
