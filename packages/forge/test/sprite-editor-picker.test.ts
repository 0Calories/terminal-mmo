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
import type { PaletteEntry } from '../src/sprite-editor/state';

const ENTRIES: PaletteEntry[] = [
	{ key: 'p', rgba: [1, 2, 3, 255], label: 'player hue', kind: 'dynamic' },
	{ key: 'g', rgba: [4, 5, 6, 255], label: 'g', kind: 'palette' },
	{ key: 'q', rgba: [7, 8, 9, 255], label: 'q', kind: 'local' },
];

describe('buildPickerOptions', () => {
	test('fg: entries then a "new" row', () => {
		const opts = buildPickerOptions('fg', ENTRIES);
		expect(opts[0]).toEqual({ kind: 'entry', entry: ENTRIES[0] });
		expect(opts.at(-1)).toEqual({ kind: 'new' });
		expect(opts.some((o) => o.kind === 'none')).toBe(false);
	});
	test('bg: a "none" row leads, then entries, then "new"', () => {
		const opts = buildPickerOptions('bg', ENTRIES);
		expect(opts[0]).toEqual({ kind: 'none' });
		expect(opts.at(-1)).toEqual({ kind: 'new' });
	});
});

describe('openPicker lands on the current selection', () => {
	test('fg lands on the current key', () => {
		const p = openPicker('fg', ENTRIES, 'g');
		const opt = currentOption(p);
		expect(opt.kind === 'entry' && opt.entry.key).toBe('g');
	});
	test('bg with null lands on none', () => {
		const p = openPicker('bg', ENTRIES, null);
		expect(currentOption(p).kind).toBe('none');
	});
});

describe('navigation', () => {
	test('pickerMove wraps around', () => {
		const p = openPicker('fg', ENTRIES, 'p');
		expect(pickerMove(p, -1).index).toBe(p.options.length - 1);
		const last = { ...p, index: p.options.length - 1 };
		expect(pickerMove(last, 1).index).toBe(0);
	});
});

describe('choosing a list row', () => {
	test('choosing an fg entry emits setFg + closes', () => {
		const p = openPicker('fg', ENTRIES, 'q');
		const res = pickerChoose(p);
		expect(res.picker).toBeNull();
		expect(res.action).toEqual({ type: 'setFg', key: 'q' });
	});
	test('choosing a bg entry emits setBg', () => {
		let p = openPicker('bg', ENTRIES, null);
		p = { ...p, index: p.options.findIndex((o) => o.kind === 'entry') };
		const res = pickerChoose(p);
		expect(res.action?.type).toBe('setBg');
	});
	test('choosing none clears the bg', () => {
		const p = openPicker('bg', ENTRIES, null);
		const res = pickerChoose(p);
		expect(res.action).toEqual({ type: 'setBg', key: null });
	});
	test('choosing "new" opens the define form', () => {
		let p = openPicker('fg', ENTRIES, 'p');
		p = { ...p, index: p.options.length - 1 };
		const res = pickerChoose(p);
		expect(res.action).toBeUndefined();
		expect(res.picker?.form?.stage).toBe('key');
	});
});

describe('define-a-local-color form', () => {
	function openForm() {
		let p = openPicker('fg', ENTRIES, 'p');
		p = { ...p, index: p.options.length - 1 };
		return pickerChoose(p).picker as PickerState;
	}

	test('happy path: key then r,g,b emits defineColor', () => {
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
			slot: 'fg',
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
