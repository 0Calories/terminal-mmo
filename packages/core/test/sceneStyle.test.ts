import { describe, expect, it } from 'bun:test';
import {
	buildSceneStyle,
	SCENE_COLORS,
	SCENE_PALETTE,
} from '../src/sceneStyle';

type Col = { r: number; g: number; b: number; a: number };
const toCol = (r: number, g: number, b: number, a: number): Col => ({
	r,
	g,
	b,
	a,
});

describe('buildSceneStyle', () => {
	const style = buildSceneStyle<Col>(toCol);

	it('wraps every chrome colour with the supplied factory', () => {
		expect(style.bg).toEqual({ r: 16, g: 18, b: 26, a: 255 });
		expect(style.terrainFg).toEqual({ r: 70, g: 82, b: 104, a: 255 });
		expect(style.terrainBg).toEqual({ r: 34, g: 40, b: 54, a: 255 });
		expect(style.portal).toEqual({ r: 180, g: 130, b: 255, a: 255 });
		expect(style.transparent).toEqual({ r: 0, g: 0, b: 0, a: 0 });
		expect(style.hurt).toEqual({ r: 255, g: 240, b: 120, a: 255 });
		expect(style.nameplate).toEqual({ r: 150, g: 156, b: 168, a: 255 });
		expect(style.paletteDefault).toEqual({ r: 232, g: 232, b: 238, a: 255 });
	});

	it('maps every art palette key through the factory', () => {
		const keys = Object.keys(SCENE_PALETTE);
		expect(keys.length).toBeGreaterThan(0);
		for (const k of keys) {
			const [r, g, b, a] = SCENE_PALETTE[k as keyof typeof SCENE_PALETTE];
			expect(style.palette[k]).toEqual({ r, g, b, a });
		}
	});

	it('exposes the chrome tuples as plain (opentui-free) data', () => {
		expect(SCENE_COLORS.bg).toEqual([16, 18, 26, 255]);
		expect(Array.isArray(SCENE_COLORS.bg)).toBe(true);
	});
});
