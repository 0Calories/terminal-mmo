import { expect, test } from 'bun:test';
import { BUS_BY_KIND, BUSES, SOUND_SPECS } from '../src/sound/registry';

// Every voice must be tagged into exactly one declared bus so the mixer can route its
// play() — an untagged sound has nowhere to go (ADR 0014).
test('every sound kind maps to a declared bus', () => {
	for (const kind of Object.keys(SOUND_SPECS)) {
		const bus = BUS_BY_KIND[kind as keyof typeof BUS_BY_KIND];
		expect(BUSES).toContain(bus);
	}
});

// `ambient` is reserved-but-empty: declared so the group structure doesn't churn
// when ambient/music lands, but no voice routes to it yet.
test('ambient bus exists but has no members yet', () => {
	expect(BUSES).toContain('ambient');
	expect(Object.values(BUS_BY_KIND)).not.toContain('ambient');
});

test('combat sounds route to combat, jump to movement', () => {
	expect(BUS_BY_KIND.hit).toBe('combat');
	expect(BUS_BY_KIND.death).toBe('combat');
	expect(BUS_BY_KIND.jump).toBe('movement');
});

// The remaining self/UI voices (#148): land is locomotion (movement bus); the
// level-up flourish and menu blip are interface feedback (ui bus).
test('land routes to movement, level-up and ui-blip to ui', () => {
	expect(BUS_BY_KIND.land).toBe('movement');
	expect(BUS_BY_KIND['level-up']).toBe('ui');
	expect(BUS_BY_KIND.ui).toBe('ui');
});

// Every kind in the BUS map must have a synth source, and vice versa — a voice
// with a bus but no source (or a source with no bus) is a wiring gap.
test('every kind has both a synth spec and a bus', () => {
	const specKinds = Object.keys(SOUND_SPECS).sort();
	const busKinds = Object.keys(BUS_BY_KIND).sort();
	expect(specKinds).toEqual(busKinds);
});
