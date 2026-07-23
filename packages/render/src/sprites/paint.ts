import type { Facing } from '@mmo/core/entities';
import type { Compositor, RGBA } from '../compositor';
import type { CompiledSprite, SpritePalette } from './compile';

export interface PaintOptions {
	/** Top-left cell origin; primitives are cell-aligned (half-cell is #451). */
	readonly cellX: number;
	readonly cellY: number;
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
 * Paint a compiled Sprite frame into a Compositor at a cell origin and facing,
 * resolving every colour KEY through the palettes and optional recolor. Pixels
 * composite source-over; Glyph stamps are atomic cells.
 */
export function paintSprite(
	compositor: Compositor,
	sprite: CompiledSprite,
	opts: PaintOptions,
): void {
	const facing = opts.facing ?? 1;
	const side = facing === 1 ? sprite.right : sprite.left;
	const originPx = opts.cellX * 2;
	const originPy = opts.cellY * 2;

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
			opts.cellX + g.cellX,
			opts.cellY + g.cellY,
			g.char,
			fg,
			bg,
		);
	}
}
