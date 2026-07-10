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

// Append-only so wire hue ids stay stable.
export const HUES = [
	[255, 150, 40, 255],
	[235, 90, 90, 255],
	[120, 215, 120, 255],
	[90, 170, 255, 255],
	[200, 120, 240, 255],
	[245, 215, 95, 255],
	[120, 225, 230, 255],
	[245, 150, 205, 255],
] as const satisfies readonly RGBAQuad[];

// Append-only so wire nameplate ids stay stable.
export const NAMEPLATE_COLORS = [
	[150, 156, 168, 255],
	[120, 200, 255, 255],
	[130, 230, 140, 255],
	[210, 150, 255, 255],
	[255, 140, 140, 255],
	[245, 215, 110, 255],
	[140, 235, 235, 255],
	[245, 160, 205, 255],
] as const satisfies readonly RGBAQuad[];

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
