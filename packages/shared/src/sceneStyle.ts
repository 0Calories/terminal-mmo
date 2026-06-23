import type { RenderStyle } from './render';

// The static Zone scene's colour DATA, as plain RGBA int tuples — the single
// source of truth shared by the game (client) and `forge zone preview` (forge),
// so the preview is faithful ("what you see is what ships", #56). It is data
// only: @mmo/shared stays opentui-free, and each consumer binds its own colour
// type (opentui `RGBA.fromInts`) via `buildSceneStyle`.
export type RGBAQuad = readonly [number, number, number, number];

// Chrome the static renderer needs (mirrors the subset of the client theme that
// `RenderStyle` consumes). `nameplate` is the client's dim text; `paletteDefault`
// is its bright HUD colour, used for sprite glyphs whose key isn't in the palette.
export const SCENE_COLORS = {
	bg: [16, 18, 26, 255],
	terrainFg: [70, 82, 104, 255],
	terrainBg: [34, 40, 54, 255],
	portal: [180, 130, 255, 255],
	transparent: [0, 0, 0, 0],
	hurt: [255, 240, 120, 255],
	// `nameplate` is the handle text colour (the cosmetic plate colour, #35). The
	// nameplate is a 2-row pill chip drawn directly below the feet (#103, ADR 0016):
	// over terrain it is a faint translucent WASH of the cosmetic colour (a tint of the
	// terrain under it) with the handle on top at full opacity; off terrain the pill is
	// not drawn at all and only the handle glyph shows. The wash alpha lives in
	// `NAMEPLATE_WASH_ALPHA` since @mmo/shared can't derive a low-alpha colour at draw
	// time (it only holds opaque resolved colours).
	nameplate: [150, 156, 168, 255],
	paletteDefault: [232, 232, 238, 255],
} as const satisfies Record<string, RGBAQuad>;

// Opacity of the over-terrain nameplate pill, as an 8-bit alpha. The pill is the
// cosmetic colour at this alpha, blended over the terrain beneath it (#103, ADR 0016);
// ~8% reads as a barely-there wash that lets terrain show through while still framing the
// handle. A judgement call, tuned in a real terminal.
export const NAMEPLATE_WASH_ALPHA = 20;

// The cosmetic Avatar hue catalog (#35, ADR 0003): the body-recolour options an
// Avatar chooses from, indexed by the on-the-wire hue id. Index 0 is the default
// amber (identical to the `p` body key) so a defaulted Avatar looks unchanged. The
// rest are a small, fixed, reviewed set. Append-only so ids stay stable.
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

// The cosmetic nameplate-colour catalog (#35): the handle-tint options, indexed by
// the on-the-wire nameplate id. Index 0 is the default dim grey (identical to
// SCENE_COLORS.nameplate). Append-only so ids stay stable.
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
 * Resolve the shared scene colour data into a `RenderStyle<C>` using a caller-
 * supplied colour factory. One place builds the style so the game and the
 * `forge zone preview` can't drift apart.
 */
export function buildSceneStyle<C>(toColor: ColorFactory<C>): RenderStyle<C> {
	const c = (q: RGBAQuad) => toColor(q[0], q[1], q[2], q[3]);
	// Same RGB as `c`, but forced to the translucent nameplate-pill alpha (ADR 0016).
	const wash = (q: RGBAQuad) => toColor(q[0], q[1], q[2], NAMEPLATE_WASH_ALPHA);
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
		// The default handle's pill wash (no cosmetics): the dim grey at the wash alpha.
		nameplateWash: wash(SCENE_COLORS.nameplate),
		palette,
		paletteDefault: c(SCENE_COLORS.paletteDefault),
		// Cosmetic catalogs resolved into the colour type once, so the renderer can
		// index them per Avatar without re-resolving (#35). `nameplateWashes` is the
		// parallel low-alpha pill colour for each handle tint, prebuilt here because the
		// generic renderer can't derive a translucent variant from an opaque `C`.
		cosmetics: {
			hues: HUES.map((q) => c(q)),
			nameplates: NAMEPLATE_COLORS.map((q) => c(q)),
			nameplateWashes: NAMEPLATE_COLORS.map((q) => wash(q)),
		},
	};
}
