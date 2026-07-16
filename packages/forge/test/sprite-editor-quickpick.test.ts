// The `c` ink quick-pick overlay (spec #397, locked #383): random-access ink
// selection by typeahead, rail index, or arrows, then Enter. Pure reducers
// asserted as state → action → highlighted option / chosen ink.
import { describe, expect, test } from 'bun:test';
import { STANDARD_PALETTE } from '@mmo/core/entities';
import {
	currentQuickOption,
	openQuickPick,
	optionInk,
	quickPickChoose,
	quickPickMove,
	quickPickOptions,
	quickPickType,
} from '../src/sprite-editor/quickPick';
import {
	colorInk,
	initSpriteEditor,
	paletteEntries,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SPRITE_PREVIEWS } from '../src/sprite-editor/view';

function entries() {
	const state = initSpriteEditor(emptySpriteDoc('q', 'hat'));
	return paletteEntries(state, STANDARD_PALETTE, SPRITE_PREVIEWS);
}

describe('quickPick — rail order and openers', () => {
	test('options are the palette entries then transparent, in rail order', () => {
		const es = entries();
		const opts = quickPickOptions(es);
		expect(opts).toHaveLength(es.length + 1);
		expect(opts[0]).toEqual({ kind: 'entry', entry: es[0] });
		expect(opts[opts.length - 1]).toEqual({ kind: 'transparent' });
	});

	test('opening lands the highlight on the currently active ink', () => {
		const es = entries();
		const target = es[3].key;
		const p = openQuickPick(es, colorInk(target));
		expect(optionInk(currentQuickOption(p))).toEqual(colorInk(target));
	});

	test('opening on transparent highlights the transparent row', () => {
		const p = openQuickPick(entries(), TRANSPARENT_INK);
		expect(currentQuickOption(p)).toEqual({ kind: 'transparent' });
	});
});

describe('quickPick — navigation & selection', () => {
	test('arrows move the highlight and wrap', () => {
		const es = entries();
		const p = openQuickPick(es, colorInk(es[0].key));
		expect(quickPickMove(p, 1).index).toBe(1);
		// Backwards from the first wraps to the last (transparent).
		expect(currentQuickOption(quickPickMove(p, -1))).toEqual({
			kind: 'transparent',
		});
	});

	test('typeahead jumps to the option whose rail key matches', () => {
		const es = entries();
		const p = openQuickPick(es, colorInk(es[0].key));
		// STANDARD_PALETTE carries a 'c' cyan key; typing it selects that swatch.
		const jumped = quickPickType(p, 'c');
		expect(optionInk(currentQuickOption(jumped))).toEqual(colorInk('c'));
		expect(jumped.query).toBe('c');
	});

	test('typing t highlights transparent', () => {
		const es = entries();
		const p = openQuickPick(es, colorInk(es[0].key));
		expect(currentQuickOption(quickPickType(p, 't'))).toEqual({
			kind: 'transparent',
		});
	});

	test('a digit selects that 1-based rail index', () => {
		const es = entries();
		const p = openQuickPick(es, colorInk(es[0].key));
		// No entry keyed '3', so '3' is read as the rail index → third option.
		expect(quickPickType(p, '3').index).toBe(2);
	});

	test('a char that resolves nowhere leaves the highlight put', () => {
		const es = entries();
		const p = quickPickMove(openQuickPick(es, colorInk(es[0].key)), 2);
		expect(quickPickType(p, '§').index).toBe(p.index);
	});

	test('Enter commits the highlighted option to an ink', () => {
		const es = entries();
		const p = quickPickType(openQuickPick(es, colorInk(es[0].key)), 't');
		expect(quickPickChoose(p)).toEqual(TRANSPARENT_INK);
	});
});
