import type { RenderStyle } from './render';

// The Zone scene's colour data as plain RGBA int tuples, shared by the client and `forge
// zone preview` so the preview is faithful (#56). Data only — @mmo/shared stays
// opentui-free; each consumer binds its colour type via `buildSceneStyle`.
export type RGBAQuad = readonly [number, number, number, number];

// Chrome the static renderer needs. `paletteDefault` is the bright HUD colour, used for
// sprite glyphs whose key isn't in the palette.
export const SCENE_COLORS = {
	bg: [16, 18, 26, 255],
	terrainFg: [70, 82, 104, 255],
	terrainBg: [34, 40, 54, 255],
	portal: [180, 130, 255, 255],
	transparent: [0, 0, 0, 0],
	hurt: [255, 240, 120, 255],
	// The Handle text colour. The Handle is bright ink on an opaque ~30%-darkened same-hue
	// backing (`nameplateBg`), prebuilt below because @mmo/shared can't darken a resolved
	// colour at draw time (ADR 0023, #35).
	nameplate: [150, 156, 168, 255],
	paletteDefault: [232, 232, 238, 255],
} as const satisfies Record<string, RGBAQuad>;

// How much to darken a nameplate colour for its backing so the ink reads legibly over any
// terrain/sprite/sky. A judgement call, tuned in a real terminal (ADR 0023).
export const NAMEPLATE_BG_DARKEN = 0.3;

// An opaque, darkened variant of an RGBA tuple — the Handle backing: same hue as the ink,
// far darker, so the cosmetic colour still reads (ADR 0023).
export function darken(q: RGBAQuad): RGBAQuad {
	return [
		Math.round(q[0] * NAMEPLATE_BG_DARKEN),
		Math.round(q[1] * NAMEPLATE_BG_DARKEN),
		Math.round(q[2] * NAMEPLATE_BG_DARKEN),
		255,
	];
}

// The cosmetic Avatar hue catalog (#35, ADR 0003), indexed by the wire hue id. Index 0 is
// the default amber (identical to the `p` body key). Append-only so ids stay stable.
//
// VISUAL ARTEFACT — this palette needs design review / sign-off before merge.
export const HUES = [
	[255, 150, 40, 255], // amber (default)
	[235, 90, 90, 255], // red
	[120, 215, 120, 255], // green
	[90, 170, 255, 255], // blue
	[200, 120, 240, 255], // purple
	[245, 215, 95, 255], // gold
	[120, 225, 230, 255], // cyan
	[245, 150, 205, 255], // pink
] as const satisfies readonly RGBAQuad[];

// The cosmetic nameplate-colour catalog (#35), indexed by the wire nameplate id. Index 0
// is the default dim grey (identical to SCENE_COLORS.nameplate). Append-only so ids stay
// stable.
//
// VISUAL ARTEFACT — this set needs design review / sign-off before merge.
export const NAMEPLATE_COLORS = [
	[150, 156, 168, 255], // grey (default)
	[120, 200, 255, 255], // blue
	[130, 230, 140, 255], // green
	[210, 150, 255, 255], // purple
	[255, 140, 140, 255], // red
	[245, 215, 110, 255], // gold
	[140, 235, 235, 255], // cyan
	[245, 160, 205, 255], // pink
] as const satisfies readonly RGBAQuad[];

// The recolourable art palette, keyed by a Sprite's single-char colour codes.
export const SCENE_PALETTE = {
	p: [255, 150, 40, 255],
	m: [220, 90, 90, 255],
	g: [170, 240, 95, 255],
	s: [186, 196, 210, 255],
	w: [150, 96, 52, 255],
	y: [242, 210, 92, 255],
	e: [236, 190, 150, 255],
	f: [110, 200, 110, 255],
	c: [132, 222, 230, 255],
	o: [232, 230, 216, 255],
	k: [64, 66, 82, 255],
} as const satisfies Record<string, RGBAQuad>;

/** Build a colour `C` from an RGBA int tuple (e.g. opentui's `RGBA.fromInts`). */
export type ColorFactory<C> = (r: number, g: number, b: number, a: number) => C;

/**
 * Resolve the shared scene colour data into a `RenderStyle<C>` via a caller-supplied colour
 * factory. One place, so the game and `forge zone preview` can't drift apart.
 */
export function buildSceneStyle<C>(toColor: ColorFactory<C>): RenderStyle<C> {
	const c = (q: RGBAQuad) => toColor(q[0], q[1], q[2], q[3]);
	// Same hue as `c`, but ~30%-darkened and opaque — the per-glyph Handle backing (ADR 0023).
	const bg = (q: RGBAQuad) => c(darken(q));
	const palette: Record<string, C> = {};
	for (const [k, q] of Object.entries(SCENE_PALETTE)) palette[k] = c(q);
	return {
		bg: c(SCENE_COLORS.bg),
		terrainFg: c(SCENE_COLORS.terrainFg),
		terrainBg: c(SCENE_COLORS.terrainBg),
		portal: c(SCENE_COLORS.portal),
		transparent: c(SCENE_COLORS.transparent),
		hurt: c(SCENE_COLORS.hurt),
		nameplate: c(SCENE_COLORS.nameplate),
		// The default Handle's backing (no cosmetics): the dim grey, darkened.
		nameplateBg: bg(SCENE_COLORS.nameplate),
		palette,
		paletteDefault: c(SCENE_COLORS.paletteDefault),
		// Cosmetic catalogs resolved into the colour type once, so the renderer can index
		// per Avatar without re-resolving. `nameplateBgs` is prebuilt here because the
		// generic renderer can't darken an opaque `C` (#35, ADR 0023).
		cosmetics: {
			hues: HUES.map((q) => c(q)),
			nameplates: NAMEPLATE_COLORS.map((q) => c(q)),
			nameplateBgs: NAMEPLATE_COLORS.map((q) => bg(q)),
		},
	};
}
