import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core/entities';
import {
	RAIL_W,
	railActionAt,
	railModel,
	TOOL_GLYPH_FALLBACKS,
} from '../src/sprite-editor/chrome';
import {
	colorInk,
	initSpriteEditor,
	paletteEntries,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SPRITE_PREVIEWS } from '../src/sprite-editor/view';

function model() {
	const state = initSpriteEditor(emptySpriteDoc('rail', 'hat'));
	return railModel({
		tool: 'paint',
		ink: colorInk('p'),
		entries: paletteEntries(state, SCENE_PALETTE, SPRITE_PREVIEWS),
		animation: state.animation,
		fps: 8,
		frameCount: 1,
		playMode: 'none',
		height: 24,
		previewOn: true,
		variants: [
			{ channel: 'p', index: 0, rgba: [1, 2, 3, 255], active: true },
			{ channel: 'p', index: 1, rgba: [4, 5, 6, 255], active: false },
		],
	});
}

describe('Rail accessibility laws', () => {
	test('every rendered action span is reachable through the same hit-test map', () => {
		const rows = model();
		let actions = 0;
		for (const [y, row] of rows.entries()) {
			let x = 0;
			for (const span of row.spans) {
				if (span.action) {
					actions++;
					for (let dx = 0; dx < span.text.length; dx++)
						expect(railActionAt(rows, x + dx, y)).toEqual(span.action);
				}
				x += span.text.length;
			}
			expect(x).toBeLessThanOrEqual(RAIL_W - 1);
		}
		expect(actions).toBeGreaterThan(0);
		expect(railActionAt(rows, RAIL_W + 1, 0)).toBeUndefined();
		expect(railActionAt(rows, 0, rows.length + 1)).toBeUndefined();
	});

	test('fallback tool glyphs obey the renderer single-column contract', () => {
		const glyphs = Object.values(TOOL_GLYPH_FALLBACKS);
		expect(glyphs.length).toBeGreaterThan(0);
		for (const glyph of glyphs) {
			expect([...glyph]).toHaveLength(1);
			expect(Bun.stringWidth(glyph)).toBe(1);
		}
	});
});
