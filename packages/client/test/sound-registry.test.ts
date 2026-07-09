import { expect, test } from 'bun:test';
import { BUS_BY_KIND, BUSES, SOUND_SPECS } from '../src/sound/registry';

test('every sound kind maps to a declared bus', () => {
	for (const kind of Object.keys(SOUND_SPECS)) {
		const bus = BUS_BY_KIND[kind as keyof typeof BUS_BY_KIND];
		expect(BUSES).toContain(bus);
	}
});

test('ambient bus exists but has no members yet', () => {
	expect(BUSES).toContain('ambient');
	expect(Object.values(BUS_BY_KIND)).not.toContain('ambient');
});

test('combat sounds route to combat, jump to movement', () => {
	expect(BUS_BY_KIND.hit).toBe('combat');
	expect(BUS_BY_KIND.death).toBe('combat');
	expect(BUS_BY_KIND.jump).toBe('movement');
});

test('land routes to movement, level-up and ui-blip to ui', () => {
	expect(BUS_BY_KIND.land).toBe('movement');
	expect(BUS_BY_KIND['level-up']).toBe('ui');
	expect(BUS_BY_KIND.ui).toBe('ui');
});

test('every kind has both a synth spec and a bus', () => {
	const specKinds = Object.keys(SOUND_SPECS).sort();
	const busKinds = Object.keys(BUS_BY_KIND).sort();
	expect(specKinds).toEqual(busKinds);
});
