import {
	darken,
	HUES,
	NAMEPLATE_COLORS,
	type RGBAQuad,
	SCENE_COLORS,
	SCENE_PALETTE,
} from '@mmo/core';
import type { RenderStyle } from './render';

// Realizes the @mmo/core scene palette (plain RGBA data the sim references for tint)
// into a renderer-ready RenderStyle in the caller's cell-colour type C.
export type ColorFactory<C> = (r: number, g: number, b: number, a: number) => C;

export function buildSceneStyle<C>(toColor: ColorFactory<C>): RenderStyle<C> {
	const c = (q: RGBAQuad) => toColor(q[0], q[1], q[2], q[3]);
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
		nameplateBg: bg(SCENE_COLORS.nameplate),
		palette,
		paletteDefault: c(SCENE_COLORS.paletteDefault),
		cosmetics: {
			hues: HUES.map((q) => c(q)),
			nameplates: NAMEPLATE_COLORS.map((q) => c(q)),
			nameplateBgs: NAMEPLATE_COLORS.map((q) => bg(q)),
		},
	};
}
