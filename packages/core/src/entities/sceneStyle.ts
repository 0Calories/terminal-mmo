export type RGBAQuad = readonly [number, number, number, number];

export const SCENE_COLORS = {
	bg: [16, 18, 26, 255],
	terrainFg: [70, 82, 104, 255],
	terrainBg: [34, 40, 54, 255],
	portal: [180, 130, 255, 255],
	transparent: [0, 0, 0, 0],
	hurt: [255, 240, 120, 255],
	nameplate: [150, 156, 168, 255],
	paletteDefault: [232, 232, 238, 255],
} as const satisfies Record<string, RGBAQuad>;

export const NAMEPLATE_BG_DARKEN = 0.3;

export function darken(q: RGBAQuad): RGBAQuad {
	return [
		Math.round(q[0] * NAMEPLATE_BG_DARKEN),
		Math.round(q[1] * NAMEPLATE_BG_DARKEN),
		Math.round(q[2] * NAMEPLATE_BG_DARKEN),
		255,
	];
}

// The single standard colour palette (15 colours). Sub-palettes (SCENE_PALETTE,
// HUES, NAMEPLATE_COLORS, RARITY_COLOR) are curated selections from this — one
// source of truth for every rendered pixel and read colour.
export const STANDARD_PALETTE = {
	k: [64, 66, 82, 255],
	n: [150, 156, 168, 255],
	s: [186, 196, 210, 255],
	o: [232, 230, 216, 255],
	w: [150, 96, 52, 255],
	e: [236, 190, 150, 255],
	p: [255, 150, 40, 255],
	m: [220, 90, 90, 255],
	y: [242, 210, 92, 255],
	g: [170, 240, 95, 255],
	f: [110, 200, 110, 255],
	c: [132, 222, 230, 255],
	b: [101, 176, 255, 255],
	v: [200, 130, 250, 255],
	r: [245, 155, 205, 255],
} as const satisfies Record<string, RGBAQuad>;

// SCENE_PALETTE = the 11 keys usable in `.sprite` art (excludes the 4 curated
// nameplate/hue/rarity families n b v r). Existing art keys unchanged.
export const SCENE_PALETTE = {
	p: STANDARD_PALETTE.p,
	m: STANDARD_PALETTE.m,
	g: STANDARD_PALETTE.g,
	s: STANDARD_PALETTE.s,
	w: STANDARD_PALETTE.w,
	y: STANDARD_PALETTE.y,
	e: STANDARD_PALETTE.e,
	f: STANDARD_PALETTE.f,
	c: STANDARD_PALETTE.c,
	o: STANDARD_PALETTE.o,
	k: STANDARD_PALETTE.k,
} as const satisfies Record<string, RGBAQuad>;

// Body-recolour hues, order = wire hue ids (append-only, never reorder — ids
// are wire-stable). Selection: p m f b v y c r.
export const HUES = [
	STANDARD_PALETTE.p,
	STANDARD_PALETTE.m,
	STANDARD_PALETTE.f,
	STANDARD_PALETTE.b,
	STANDARD_PALETTE.v,
	STANDARD_PALETTE.y,
	STANDARD_PALETTE.c,
	STANDARD_PALETTE.r,
] as const satisfies readonly RGBAQuad[];

// Nameplate colours, order = wire nameplate ids (append-only, never reorder —
// ids are wire-stable). Selection: n b f v m y c r.
export const NAMEPLATE_COLORS = [
	STANDARD_PALETTE.n,
	STANDARD_PALETTE.b,
	STANDARD_PALETTE.f,
	STANDARD_PALETTE.v,
	STANDARD_PALETTE.m,
	STANDARD_PALETTE.y,
	STANDARD_PALETTE.c,
	STANDARD_PALETTE.r,
] as const satisfies readonly RGBAQuad[];
