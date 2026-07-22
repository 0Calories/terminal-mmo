import { describe, expect, test } from 'bun:test';
import { HUES, SCENE_PALETTE } from '@mmo/core/entities';
import { RARITY_COLOR } from '@mmo/core/items';
import {
	bitName,
	dirForRole,
	docDynamicUsage,
	parseEditArg,
	pixelToScreen,
	quadrantMarker,
	resolveColorKey,
	roleForDir,
	SPRITE_PREVIEWS,
	screenToPixel,
	scrollViewport,
	variantPreviews,
	visiblePixels,
} from '../src/sprite-editor/view';

describe('Sprite editor view laws', () => {
	test('role paths round-trip and edit arguments resolve semantically', () => {
		for (const role of ['form', 'weapon', 'hat', 'monster', 'npc'] as const)
			expect(roleForDir(dirForRole(role))).toBe(role);

		expect(parseEditArg('sprites/weapons/sword.sprite')).toEqual({
			id: 'sword',
			role: 'weapon',
		});
		expect(parseEditArg('buddy')).toEqual({ id: 'buddy' });
		expect(parseEditArg('')).toBeUndefined();
	});

	test('colour resolution respects transparency, local precedence, and dynamic previews', () => {
		const local = { g: [10, 20, 30, 255] as const };
		expect(
			resolveColorKey('', local, SCENE_PALETTE, SPRITE_PREVIEWS),
		).toBeNull();
		expect(resolveColorKey('g', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			local.g,
		);
		expect(resolveColorKey('p', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			SPRITE_PREVIEWS.p,
		);
		expect(
			resolveColorKey('?', local, SCENE_PALETTE, SPRITE_PREVIEWS),
		).toBeNull();
	});

	test('screen and Pixel projections round-trip to the containing zoom block', () => {
		for (const zoom of [1, 2, 4]) {
			const camera = { x: 3, y: 2 };
			const pixel = screenToPixel(7, 5, camera, zoom);
			const screen = pixelToScreen(pixel.x, pixel.y, camera, zoom);
			expect(screen.x).toBeLessThanOrEqual(7);
			expect(screen.y).toBeLessThanOrEqual(5);
			expect(screen.x + zoom).toBeGreaterThan(7);
			expect(screen.y + zoom).toBeGreaterThan(5);
		}
		expect(visiblePixels(21, 4)).toBe(5);
	});

	test('viewport following keeps both axes within view', () => {
		const moved = scrollViewport({ x: 0, y: 0 }, { x: 30, y: 20 }, 10, 8, 2);
		expect(moved.x).toBeGreaterThan(0);
		expect(moved.y).toBeGreaterThan(0);
		const stable = scrollViewport(
			moved,
			{ x: moved.x + 2, y: moved.y + 2 },
			10,
			8,
			2,
		);
		expect(stable).toEqual(moved);
	});

	test('quadrant markers preserve a one-to-one bit identity', () => {
		const markers = [0, 1, 2, 3].map((bit) => quadrantMarker(bit));
		expect(new Set(markers).size).toBe(4);
		expect([0, 1, 2, 3].map((bit) => bitName(bit))).toEqual([
			'TL',
			'TR',
			'BL',
			'BR',
		]);
	});

	test('dynamic colour usage and preview selection are deterministic per channel', () => {
		const rows = ['▘▘'];
		const doc = {
			id: 'dynamic',
			key: 'p',
			baseline: 0,
			anchors: {},
			animations: [
				{
					name: 'idle',
					frames: [{ rows, colors: ['·a'], bg: ['  '], anchors: {} }],
				},
			],
			colors: {},
		};
		expect(docDynamicUsage(doc)).toEqual({ p: true, a: true });

		const accents = Object.values(RARITY_COLOR);
		expect(variantPreviews(HUES.length, accents.length)).toEqual(
			variantPreviews(0, 0),
		);
		expect(variantPreviews(1, 0).a).toEqual(variantPreviews(0, 0).a);
		expect(variantPreviews(0, 1).p).toEqual(variantPreviews(0, 0).p);
	});
});
