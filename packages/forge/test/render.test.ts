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
		expect(out).toContain('# wall (full solid)');
		expect(out).toContain('c chaser spawn');
		// no platforms in this zone → the legend must not advertise `=`
		expect(out).not.toContain('one-way platform');
	});

	test('a one-way platform round-trips through parse → render as = (ADR 0026)', () => {
		const text = [
			'{"type":"field"}',
			'---',
			'..==..', // a one-way platform strip
			'......',
			'######',
		].join('\n');
		const zone = parseZone(text, catalogs, 'field-01');

		const out = renderZone(zone);

		// the platform draws back as `=` (cell 2 → glyph), not dropped to `.` or `#`
		expect(out).toContain('..==..');
		// and the legend now names it
		expect(out).toContain('= one-way platform');
	});
});
