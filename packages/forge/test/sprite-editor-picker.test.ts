import { describe, expect, test } from 'bun:test';
import type { PickerState } from '../src/sprite-editor/picker';
import {
	buildPickerOptions,
	currentOption,
	formAdvance,
	formBackspace,
	formInput,
	openPicker,
	pickerBack,
	pickerChoose,
	pickerMove,
} from '../src/sprite-editor/picker';
import {
	colorInk,
	type PaletteEntry,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';

const ENTRIES: PaletteEntry[] = [
	{ key: 'p', rgba: [1, 2, 3, 255], label: 'player hue', kind: 'dynamic' },
	{ key: 'g', rgba: [4, 5, 6, 255], label: 'g', kind: 'palette' },
	{ key: 'q', rgba: [7, 8, 9, 255], label: 'q', kind: 'local' },
];

describe('buildPickerOptions', () => {
	test('a transparent row leads, then entries, then "new" — transparent is an ink', () => {
		const opts = buildPickerOptions(ENTRIES);
		expect(opts[0]).toEqual({ kind: 'transparent' });
		expect(opts[1]).toEqual({ kind: 'entry', entry: ENTRIES[0] });
		expect(opts.at(-1)).toEqual({ kind: 'new' });
	});
});

describe('openPicker lands on the current ink', () => {
	test('a colour ink lands on its key', () => {
		const p = openPicker(ENTRIES, colorInk('g'));
		const opt = currentOption(p);
		expect(opt.kind === 'entry' && opt.entry.key).toBe('g');
	});
	test('transparent ink lands on the transparent row', () => {
		const p = openPicker(ENTRIES, TRANSPARENT_INK);
		expect(currentOption(p).kind).toBe('transparent');
	});
});

describe('navigation', () => {
	test('pickerMove wraps around', () => {
		const p = { ...openPicker(ENTRIES, TRANSPARENT_INK), index: 0 };
		expect(pickerMove(p, -1).index).toBe(p.options.length - 1);
		const last = { ...p, index: p.options.length - 1 };
		expect(pickerMove(last, 1).index).toBe(0);
	});
});

describe('choosing a list row', () => {
	test('choosing a colour entry emits setInk + closes', () => {
		const p = openPicker(ENTRIES, colorInk('q'));
		const res = pickerChoose(p);
		expect(res.picker).toBeNull();
		expect(res.action).toEqual({ type: 'setInk', ink: colorInk('q') });
	});
	test('choosing the transparent row emits transparent setInk', () => {
		const p = openPicker(ENTRIES, colorInk('g'));
		const res = pickerChoose({
			...p,
			index: p.options.findIndex((o) => o.kind === 'transparent'),
		});
		expect(res.action).toEqual({ type: 'setInk', ink: TRANSPARENT_INK });
	});
	test('choosing "new" opens the define form', () => {
		const p = openPicker(ENTRIES, colorInk('p'));
		const res = pickerChoose({ ...p, index: p.options.length - 1 });
		expect(res.action).toBeUndefined();
		expect(res.picker?.form?.stage).toBe('key');
	});
});

describe('define-a-local-color form', () => {
	function openForm() {
		const p = openPicker(ENTRIES, colorInk('p'));
		return pickerChoose({ ...p, index: p.options.length - 1 })
			.picker as PickerState;
	}

	test('happy path: key then r,g,b emits defineColor (no slot)', () => {
		let p = openForm();
		p = formInput(p, 'z');
		expect(p.form?.key).toBe('z');
		p = formAdvance(p).picker as PickerState;
		expect(p.form?.stage).toBe('r');
		p = formInput(p, '1');
		p = formInput(p, '0');
		p = formAdvance(p).picker as PickerState; // r -> g
		p = formInput(p, '2');
		p = formInput(p, '0');
		p = formAdvance(p).picker as PickerState; // g -> b
		p = formInput(p, '3');
		p = formInput(p, '0');
		const res = formAdvance(p); // b -> done
		expect(res.picker).toBeNull();
		expect(res.action).toEqual({
			type: 'defineColor',
			key: 'z',
			rgba: [10, 20, 30, 255],
		});
	});

	test('reserved keys are rejected with an error', () => {
		let p = openForm();
		p = formInput(p, 'p');
		const res = formAdvance(p);
		expect(res.action).toBeUndefined();
		expect(res.picker?.error).toContain('reserved');
	});

	test('out-of-range channels are rejected', () => {
		let p = openForm();
		p = formAdvance(formInput(p, 'z')).picker as PickerState;
		p = formAdvance(formInput(formInput(formInput(p, '9'), '9'), '9'))
			.picker as PickerState; // r=999? capped at 3 -> 999
		p = formAdvance(formInput(p, '0')).picker as PickerState; // g
		p = formInput(p, '0');
		const res = formAdvance(p);
		expect(res.action).toBeUndefined();
		expect(res.picker?.error).toContain('0..255');
	});

	test('digits only in channel fields; capped at 3 chars', () => {
		let p = openForm();
		p = formAdvance(formInput(p, 'z')).picker as PickerState;
		p = formInput(p, 'x'); // ignored
		p = formInput(formInput(formInput(formInput(p, '1'), '2'), '3'), '4');
		expect(p.form?.r).toBe('123');
	});

	test('backspace edits the active field', () => {
		let p = openForm();
		p = formAdvance(formInput(p, 'z')).picker as PickerState;
		p = formInput(formInput(p, '1'), '2');
		p = formBackspace(p);
		expect(p.form?.r).toBe('1');
	});

	test('escape steps the form back a stage, then out to the list, then closes', () => {
		let p = openForm();
		p = formAdvance(formInput(p, 'z')).picker as PickerState; // on r
		p = pickerBack(p).picker as PickerState;
		expect(p.form?.stage).toBe('key');
		p = pickerBack(p).picker as PickerState;
		expect(p.form).toBeNull();
		const res = pickerBack(p);
		expect(res.action).toEqual({ type: 'close' });
	});
});
