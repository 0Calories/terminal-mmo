// Headless tests for the mirror-view render helper (issue #339): the current
// frame's true left-facing output, glyph MIRROR table applied, with anchors
// mirrored across the rendered width.
import { describe, expect, test } from 'bun:test';
import { parseSpriteFile } from '@mmo/render';
import type { AnchorMarker } from '../src/sprite-editor/state';
import { mirrorAnchorMarkers, mirrorRender } from '../src/sprite-editor/view';

describe('mirrorRender', () => {
	test('mirrors an asymmetric glyph (▐ → ▌)', () => {
		// A right-half-block on the left cell of a 2-wide frame.
		const { doc } = parseSpriteFile('--- idle\n▐·\n··\n', 'flag');
		if (!doc) throw new Error('fixture failed to parse');
		const m = mirrorRender(doc, 'idle');
		expect(m.width).toBe(2);
		// Right-facing had ▐ on the left; left-facing has ▌ on the right.
		const joined = m.rows.join('\n');
		expect(joined).toContain('▌');
		expect(joined).not.toContain('▐');
	});
});

describe('mirrorAnchorMarkers', () => {
	test('reflects x across the rendered width', () => {
		const markers: AnchorMarker[] = [
			{ name: 'grip', x: 0, y: 1, overridden: false },
			{ name: 'head', x: 3, y: 0, overridden: true },
		];
		const mirrored = mirrorAnchorMarkers(markers, 4);
		// width 4: x 0 → 3, x 3 → 0. y and tags are preserved.
		expect(mirrored.find((m) => m.name === 'grip')).toEqual({
			name: 'grip',
			x: 3,
			y: 1,
			overridden: false,
		});
		expect(mirrored.find((m) => m.name === 'head')).toEqual({
			name: 'head',
			x: 0,
			y: 0,
			overridden: true,
		});
	});
});
