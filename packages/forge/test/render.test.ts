import { describe, expect, test } from 'bun:test';
import type { Catalogs } from '@mmo/core';
import { parseZone } from '@mmo/core';
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

		expect(out).toContain('field-01');
		expect(out).toContain('field');
		expect(out).toContain('6×4');
		expect(out).toContain('######');
		expect(out).toContain('.c....');
		expect(out).toContain('legend:');
		expect(out).toContain('# wall (full solid)');
		expect(out).toContain('c chaser spawn');
		expect(out).not.toContain('one-way platform');
	});

	test('a one-way platform round-trips through parse → render as = (ADR 0026)', () => {
		const text = ['{"type":"field"}', '---', '..==..', '......', '######'].join(
			'\n',
		);
		const zone = parseZone(text, catalogs, 'field-01');

		const out = renderZone(zone);

		expect(out).toContain('..==..');
		expect(out).toContain('= one-way platform');
	});
});
