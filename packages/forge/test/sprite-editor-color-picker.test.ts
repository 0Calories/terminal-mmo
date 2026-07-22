import { describe, expect, test } from 'bun:test';
import { HUES, STANDARD_PALETTE } from '@mmo/core/entities';
import {
	autoAssignKey,
	backspaceHex,
	commitColorPicker,
	gridColor,
	HUE_COLS,
	moveCursor,
	openColorPicker,
	pickCell,
	rgbaToHex,
	SHADE_ROWS,
	typeHex,
} from '../src/sprite-editor/colorPicker';
import {
	colorInk,
	defineLocalColor,
	initSpriteEditor,
	type SpriteEditorState,
	setInk,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

const PALETTE_KEYS = Object.keys(STANDARD_PALETTE);

describe('gridColor', () => {
	test('is deterministic, opaque, and in range across the whole grid', () => {
		for (let row = 0; row < SHADE_ROWS; row++)
			for (let col = 0; col < HUE_COLS; col++) {
				const c = gridColor(col, row);
				expect(c).toEqual(gridColor(col, row));
				expect(c[3]).toBe(255);
				for (const ch of c.slice(0, 3)) {
					expect(ch).toBeGreaterThanOrEqual(0);
					expect(ch).toBeLessThanOrEqual(255);
				}
			}
	});
});

describe('autoAssignKey', () => {
	test('never collides with palette, locals, reserved p/a, or transparent t', () => {
		const locals = ['q', 'z'];
		const k = autoAssignKey(locals, PALETTE_KEYS);
		expect(k).not.toBe('');
		expect(k.length).toBe(1);
		expect([...locals, ...PALETTE_KEYS, 'p', 'a', 't']).not.toContain(k);
	});

	test('is deterministic and advances as keys are taken', () => {
		const first = autoAssignKey([], PALETTE_KEYS);
		expect(autoAssignKey([], PALETTE_KEYS)).toBe(first);
		const second = autoAssignKey([first], PALETTE_KEYS);
		expect(second).not.toBe(first);
	});
});

describe('openColorPicker', () => {
	test('a non-local ink opens the DEFINE flow with a fresh auto key', () => {
		const p = openColorPicker(blankState(), PALETTE_KEYS);
		expect(p.mode).toBe('define');
		expect(p.key).toBe(autoAssignKey([], PALETTE_KEYS));
	});

	test('an existing local ink opens the EDIT flow on its own key + colour', () => {
		let s = defineLocalColor(blankState(), 'z', [10, 20, 30, 255]);
		s = setInk(s, colorInk('z'));
		const p = openColorPicker(s, PALETTE_KEYS);
		expect(p.mode).toBe('edit');
		expect(p.key).toBe('z');
		expect(p.rgba).toEqual([10, 20, 30, 255]);
	});

	test('reserved p/a inks are never edited — they open DEFINE instead (spec #401)', () => {
		for (const key of ['p', 'a']) {
			const s = setInk(blankState(), colorInk(key));
			const p = openColorPicker(s, PALETTE_KEYS);
			expect(p.mode).toBe('define');
			expect(p.key).not.toBe('p');
			expect(p.key).not.toBe('a');
		}
	});

	test('a transparent ink opens the DEFINE flow', () => {
		const s = setInk(blankState(), TRANSPARENT_INK);
		expect(openColorPicker(s, PALETTE_KEYS).mode).toBe('define');
	});
});

describe('grid navigation and hex entry stay in sync', () => {
	test('moveCursor clamps at the edges and follows the grid colour', () => {
		const p0 = openColorPicker(blankState(), PALETTE_KEYS);
		const at = pickCell(p0, 3, 2);
		expect(at.rgba).toEqual(gridColor(3, 2));
		expect(at.hex).toBe(rgbaToHex(gridColor(3, 2)));

		const tl = moveCursor(moveCursor(at, -99, -99), 0, 0);
		expect(tl.col).toBe(0);
		expect(tl.row).toBe(0);
		const br = moveCursor(at, 99, 99);
		expect(br.col).toBe(HUE_COLS - 1);
		expect(br.row).toBe(SHADE_ROWS - 1);
	});

	test('typeHex accepts six hex digits and drives the composed colour', () => {
		let p = openColorPicker(blankState(), PALETTE_KEYS);
		for (const ch of '65b0ff') p = typeHex(p, ch);
		expect(p.hex).toBe('65b0ff');
		expect(p.rgba).toEqual([0x65, 0xb0, 0xff, 255]);

		expect(typeHex(p, 'a').hex).toBe('a');
	});

	test('non-hex chars are ignored; backspace edits the buffer', () => {
		let p = openColorPicker(blankState(), PALETTE_KEYS);
		p = typeHex(p, 'z');
		p = typeHex(typeHex(p, 'a'), 'b');
		expect(p.hex).toBe('ab');
		expect(backspaceHex(p).hex).toBe('a');
	});
});

describe('commit', () => {
	test('commits the composed colour under the assigned key (define)', () => {
		let p = openColorPicker(blankState(), PALETTE_KEYS);
		const key = p.key;
		for (const ch of '112233') p = typeHex(p, ch);
		const res = commitColorPicker(p);
		expect(res.picker).toBeNull();
		expect(res.action).toEqual({
			type: 'commit',
			key,
			rgba: [0x11, 0x22, 0x33, 255],
		});
	});

	test('editing keeps the same key so painted art updates on commit', () => {
		let s = defineLocalColor(blankState(), 'z', [10, 20, 30, 255]);
		s = setInk(s, colorInk('z'));
		let p = openColorPicker(s, PALETTE_KEYS);
		p = pickCell(p, 5, 5);
		const res = commitColorPicker(p);
		expect(res.action?.type).toBe('commit');
		if (res.action?.type === 'commit') {
			expect(res.action.key).toBe('z');
			expect(res.action.rgba).toEqual(gridColor(5, 5));
		}
	});
});

describe('the define flow reaches an editable ink through the pure state', () => {
	test('committing a define, applied to the doc, appears as a paintable local', () => {
		const s0 = blankState();
		const p = openColorPicker(s0, PALETTE_KEYS);
		const res = commitColorPicker(p);
		expect(res.action?.type).toBe('commit');
		if (res.action?.type !== 'commit') return;

		let s = defineLocalColor(s0, res.action.key, res.action.rgba);
		s = setInk(s, colorInk(res.action.key));
		expect(s.doc.colors[res.action.key]).toEqual(res.action.rgba);
		expect(s.ink).toEqual(colorInk(res.action.key));
	});
});

test('grid columns span distinct hues', () => {
	const first = gridColor(0, 3);
	const mid = gridColor(HUE_COLS >> 1, 3);
	expect(first).not.toEqual(mid);

	expect(HUES.length).toBeGreaterThan(0);
});
