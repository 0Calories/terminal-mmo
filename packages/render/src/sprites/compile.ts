import type { Facing } from '@mmo/core/entities';
import type { RGBA } from '../compositor';
import { quadrantsFromGlyph } from '../quadrant';
import type { Sprite } from '../sprite';
import { spriteFromDoc } from '../sprite-compile';
import type { SpriteDoc } from '../sprite-file';
import { displayColumns } from './display-width';

/** A palette maps single-character colour keys to concrete RGBA. */
export type SpritePalette = Readonly<Record<string, RGBA>>;

/** One sub-cell Pixel: a colour KEY at local pixel coords (2× the cell grid). */
export interface PixelPrimitive {
	readonly px: number;
	readonly py: number;
	readonly key: string;
}

/** One atomic Glyph stamp: an arbitrary character owning a single cell. */
export interface GlyphPrimitive {
	readonly cellX: number;
	readonly cellY: number;
	readonly char: string;
	readonly fgKey: string;
	readonly bgKey?: string;
}

/** Compiled primitives for one facing, pre-mirrored at compile time. */
export interface CompiledFacing {
	readonly pixels: readonly PixelPrimitive[];
	readonly glyphs: readonly GlyphPrimitive[];
}

/**
 * A Sprite v2 frame compiled once into reusable Pixel/Glyph primitives that
 * carry colour KEYS, never resolved RGBA. Painting resolves KEY→RGBA through a
 * palette and optional recolor, so a single compilation serves every override.
 */
export interface CompiledSprite {
	readonly widthCells: number;
	readonly heightCells: number;
	readonly baseline: number;
	readonly anchors: Readonly<Record<string, { x: number; y: number }>>;
	/** The doc's own colour palette, resolved beneath the caller's palette. */
	readonly palette: SpritePalette;
	readonly right: CompiledFacing;
	readonly left: CompiledFacing;
}

function compileFacing(
	sprite: Sprite,
	facing: Facing,
	spriteId: string,
): CompiledFacing {
	const rows = sprite.rows(facing);
	const colorKeys = sprite.colorKeys(facing);
	const bgKeys = sprite.bgKeys(facing);
	const pixels: PixelPrimitive[] = [];
	const glyphs: GlyphPrimitive[] = [];

	for (let cy = 0; cy < sprite.h; cy++) {
		for (let cx = 0; cx < sprite.w; cx++) {
			const char = rows[cy][cx];
			if (char === ' ') continue;
			const fgKey = colorKeys[cy][cx];
			const rawBg = bgKeys[cy][cx];
			const bgKey = rawBg === ' ' ? undefined : rawBg;

			const mask = quadrantsFromGlyph(char);
			if (mask !== undefined) {
				for (let quad = 0; quad < 4; quad++) {
					const on = (mask & (1 << quad)) !== 0;
					const key = on ? fgKey : bgKey;
					if (key === undefined) continue;
					pixels.push({
						px: cx * 2 + (quad & 1),
						py: cy * 2 + ((quad >> 1) & 1),
						key,
					});
				}
				continue;
			}

			const columns = displayColumns(char);
			if (columns !== 1) {
				throw new Error(
					`sprite '${spriteId}': Glyph stamp '${char}' at cell (${cx}, ${cy}) spans ${columns} terminal columns; Sprite Glyph stamps must be exactly one column`,
				);
			}
			glyphs.push({
				cellX: cx,
				cellY: cy,
				char,
				fgKey,
				...(bgKey !== undefined ? { bgKey } : {}),
			});
		}
	}

	return { pixels, glyphs };
}

/**
 * Compile a Sprite v2 document frame into reusable Pixel/Glyph primitives.
 * `label` selects a frame (as {@link spriteFromDoc}); omitted uses the Default.
 * Quadrant cells become up to four Pixels — transparent quadrants emit nothing,
 * which is what lets a lower sprite show through an overlapping one.
 */
export function compileSprite(doc: SpriteDoc, label?: string): CompiledSprite {
	const sprite = spriteFromDoc(doc, label);
	const palette: Record<string, RGBA> = {};
	for (const [key, quad] of Object.entries(doc.colors)) {
		palette[key] = [quad[0], quad[1], quad[2], quad[3]];
	}
	return {
		widthCells: sprite.w,
		heightCells: sprite.h,
		baseline: sprite.baseline,
		anchors: sprite.anchors,
		palette,
		right: compileFacing(sprite, 1, doc.id),
		left: compileFacing(sprite, -1, doc.id),
	};
}
