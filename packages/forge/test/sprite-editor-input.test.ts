import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	type EditorInput,
	normalizeKey,
	normalizeMouse,
	routeWheel,
} from '../src/sprite-editor/input';
import {
	cellAt,
	colorInk,
	initSpriteEditor,
	readPixel,
	type SpriteEditorState,
	setInk,
	setTool,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function blankState(): SpriteEditorState {
	return setTool(initSpriteEditor(emptySpriteDoc('test', 'hat')), 'paint');
}

const AT_2_1 = { x: 2, y: 1 };

describe('normalizeMouse — device encoding → canonical event', () => {
	test('maps the three buttons and a bare move', () => {
		expect(normalizeMouse({ pixel: AT_2_1, button: 'left' }).button).toBe(
			'primary',
		);
		expect(normalizeMouse({ pixel: AT_2_1, button: 'right' }).button).toBe(
			'secondary',
		);
		expect(normalizeMouse({ pixel: AT_2_1, button: 'middle' }).button).toBe(
			'middle',
		);
		expect(normalizeMouse({ pixel: AT_2_1, button: 'none' }).button).toBe(
			'none',
		);
	});

	test('carries modifiers, wheel and the pixel through', () => {
		const ev = normalizeMouse({
			pixel: { x: 5, y: 3 },
			button: 'left',
			shift: true,
			ctrl: true,
			scroll: -2,
		});
		expect(ev).toEqual({
			pixel: { x: 5, y: 3 },
			button: 'primary',
			mods: { shift: true, alt: false, ctrl: true },
			wheel: -2,
		});
	});
});

describe('normalizeKey — keyboard paint intent → canonical event', () => {
	test('ink paints like a left click; transparent like a right click', () => {
		expect(normalizeKey({ pixel: AT_2_1, paint: 'ink' }).button).toBe(
			'primary',
		);
		expect(normalizeKey({ pixel: AT_2_1, paint: 'transparent' }).button).toBe(
			'secondary',
		);
		expect(normalizeKey({ pixel: AT_2_1, paint: 'none' }).button).toBe('none');
	});

	test('the keyboard never carries a wheel', () => {
		expect(
			normalizeKey({ pixel: AT_2_1, paint: 'ink', shift: true }).wheel,
		).toBe(0);
	});
});

describe('device parity — the seam is one path, not two', () => {
	test('a mouse left-click and a keyboard ink-paint at the same pixel are identical events', () => {
		const mouse = normalizeMouse({ pixel: AT_2_1, button: 'left' });
		const keyboard = normalizeKey({ pixel: AT_2_1, paint: 'ink' });
		const canonical: EditorInput = {
			pixel: AT_2_1,
			button: 'primary',
			mods: { shift: false, alt: false, ctrl: false },
			wheel: 0,
		};
		expect(mouse).toEqual(canonical);
		expect(keyboard).toEqual(canonical);
	});

	test('and they drive the pure layer to the same next state', () => {
		const s0 = blankState();
		const viaMouse = applyInput(
			s0,
			normalizeMouse({ pixel: AT_2_1, button: 'left' }),
		);
		const viaKey = applyInput(
			s0,
			normalizeKey({ pixel: AT_2_1, paint: 'ink' }),
		);
		expect(viaMouse.doc).toEqual(viaKey.doc);
		expect(viaMouse.cursor).toEqual(viaKey.cursor);
	});
});

describe('applyInput — the single entry point into the pure layer', () => {
	test('moves the cursor to the event pixel', () => {
		const s = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 4, y: 2 }, button: 'none' }),
		);
		expect(s.cursor).toEqual({ x: 4, y: 2 });
	});

	test('primary paints the active ink at the pixel', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		expect(readPixel(s, 0, 0)).toBe(true);
		expect(cellAt(s, 0, 0).fg).toBe('g');
	});

	test('secondary paints transparent ink regardless of the active ink', () => {
		let s = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		expect(readPixel(s, 0, 0)).toBe(true);
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right' }),
		);
		expect(readPixel(s, 0, 0)).toBe(false);
	});

	test('right-button transparent ink coerces (punches the bg) instead of refusing', () => {
		let s = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		s = setInk(s, colorInk('g'));
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 1, y: 1 }, button: 'left' }),
		);
		expect(cellAt(s, 0, 0).bg).toBe('p');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 1, y: 1 }, button: 'right' }),
		);
		expect(cellAt(s, 0, 0).bg).toBe('');
		expect(s.feedback).toContain('punched');
	});

	test('the erase tool paints transparent ink even on the primary button', () => {
		let s = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		s = setTool(s, 'erase');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		expect(readPixel(s, 0, 0)).toBe(false);
	});

	test('a middle/none event only moves the cursor — no paint', () => {
		const s0 = blankState();
		const s = applyInput(
			s0,
			normalizeMouse({ pixel: { x: 1, y: 1 }, button: 'middle' }),
		);
		expect(s.doc).toBe(s0.doc);
		expect(s.cursor).toEqual({ x: 1, y: 1 });
	});
});

describe('applyInput — momentary alt-click eyedrop (spec #397)', () => {
	test('alt + a paint button samples the key under the Pixel instead of painting', () => {
		let s = setInk(blankState(), colorInk('g'));
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		s = setInk(s, colorInk('m'));
		const before = s.doc;
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', alt: true }),
		);
		expect(s.ink).toEqual(colorInk('g'));
		expect(s.doc).toBe(before);
	});

	test('alt-click eyedrops whatever tool is active', () => {
		let s = setInk(blankState(), colorInk('y'));
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 2, y: 2 }, button: 'left' }),
		);
		s = setTool(setInk(s, colorInk('m')), 'stamp');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 2, y: 2 }, button: 'right', alt: true }),
		);
		expect(s.ink).toEqual(colorInk('y'));
	});
});

describe('routeWheel — spec #387 wheel grammar', () => {
	const none = { shift: false, alt: false, ctrl: false };

	test('a plain wheel scrolls vertically', () => {
		expect(routeWheel('up', none)).toEqual({ kind: 'scroll', dx: 0, dy: -3 });
		expect(routeWheel('down', none)).toEqual({ kind: 'scroll', dx: 0, dy: 3 });
	});

	test('shift-wheel scrolls horizontally', () => {
		const shift = { ...none, shift: true };
		expect(routeWheel('up', shift)).toEqual({ kind: 'scroll', dx: -3, dy: 0 });
		expect(routeWheel('down', shift)).toEqual({ kind: 'scroll', dx: 3, dy: 0 });
	});

	test('a native horizontal wheel scrolls horizontally with or without shift', () => {
		expect(routeWheel('left', none)).toEqual({ kind: 'scroll', dx: -3, dy: 0 });
		expect(routeWheel('right', { ...none, shift: true })).toEqual({
			kind: 'scroll',
			dx: 3,
			dy: 0,
		});
	});

	test('ctrl-wheel zooms — up in, down out', () => {
		const ctrl = { ...none, ctrl: true };
		expect(routeWheel('up', ctrl)).toEqual({ kind: 'zoom', dir: 1 });
		expect(routeWheel('down', ctrl)).toEqual({ kind: 'zoom', dir: -1 });

		expect(routeWheel('left', ctrl)).toEqual({
			kind: 'scroll',
			dx: -3,
			dy: 0,
		});
	});

	test('the scroll step is tunable', () => {
		expect(routeWheel('down', none, 1)).toEqual({
			kind: 'scroll',
			dx: 0,
			dy: 1,
		});
	});
});
