import { expect, test } from 'bun:test';
import { BUS_BY_KIND, BUSES, SOUND_SPECS } from '../src/sound/registry';

test('the sound catalog is complete and routes each cue to its gameplay bus', () => {
	expect(BUSES).toContain('ambient');
	expect(Object.values(BUS_BY_KIND)).not.toContain('ambient');
	for (const kind of Object.keys(SOUND_SPECS)) {
		const bus = BUS_BY_KIND[kind as keyof typeof BUS_BY_KIND];
		expect(BUSES).toContain(bus);
	}
	expect(BUS_BY_KIND).toEqual({
		jump: 'movement',
		land: 'movement',
		hit: 'combat',
		death: 'combat',
		'level-up': 'ui',
		ui: 'ui',
	});
	expect(Object.keys(SOUND_SPECS).sort()).toEqual(
		Object.keys(BUS_BY_KIND).sort(),
	);
});
