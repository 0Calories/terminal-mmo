import { describe, expect, test } from 'bun:test';
import type { Catalogs } from '@mmo/shared';
import { parseZone } from '@mmo/shared';
import { renderZone } from '../src/render';

const catalogs: Catalogs = {
	monsters: [{ id: 'slime', behavior: 'chaser', name: 'Slime' }],
	npcs: [{ id: 'merchant', kind: 'vendor', name: 'Merchant' }],
};

describe('renderZone', () => {
	test('draws a faithful grid with terrain and entity glyphs plus a legend', () => {
		const text = [
			'{"type":"field","spawns":{"m":"slime"}}',
			'---',
			'......',
			'.m....',
			'......',
			'######',
		].join('\n');
		const zone = parseZone(text, catalogs, 'field-01');

		const out = renderZone(zone);

		// header line names the zone, its type, and inferred dims
		expect(out).toContain('field-01');
		expect(out).toContain('field');
		expect(out).toContain('6×4');
		// terrain floor is drawn faithfully
		expect(out).toContain('######');
		// the spawn glyph is overlaid at its anchor cell (col 1, row 1)
		expect(out).toContain('.c....');
		// a legend explains every glyph present
		expect(out).toContain('legend:');
		expect(out).toContain('# solid terrain');
		expect(out).toContain('c chaser spawn');
	});
});
