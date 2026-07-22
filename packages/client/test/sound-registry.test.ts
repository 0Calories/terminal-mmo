import { expect, test } from 'bun:test';
import { BUS_BY_KIND, BUSES, SOUND_SPECS } from '../src/sound/registry';

test('every sound has exactly one valid gameplay bus', () => {
	expect(Object.keys(SOUND_SPECS).sort()).toEqual(
		Object.keys(BUS_BY_KIND).sort(),
	);
	for (const bus of Object.values(BUS_BY_KIND)) expect(BUSES).toContain(bus);
});
