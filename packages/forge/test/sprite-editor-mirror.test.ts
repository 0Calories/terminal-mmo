import { describe, expect, test } from 'bun:test';
import { parseSpriteFile } from '@mmo/render';
import type { AnchorMarker } from '../src/sprite-editor/state';
import { mirrorAnchorMarkers, mirrorRender } from '../src/sprite-editor/view';

describe('mirrorRender', () => {
	test('mirrors an asymmetric glyph (▐ → ▌)', () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▐·\n··\n',
			'flag',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const m = mirrorRender(doc, 'idle');
		expect(m.width).toBe(2);

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
