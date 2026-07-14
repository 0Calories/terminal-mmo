import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	type EditorInput,
	normalizeKey,
	normalizeMouse,
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
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

// The normalized event both devices target: a left/ink paint at pixel (2,1).
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
		// Paint a pixel, then right-click it: transparent ink clears it even though
		// the active ink is a colour.
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
		// Build a two-colour opaque cell, then right-click a fg pixel.
		let s = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		); // 'p' TL
		s = setInk(s, colorInk('g'));
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 1, y: 1 }, button: 'left' }),
		); // overpaint → opaque
		expect(cellAt(s, 0, 0).bg).toBe('p');
		s = applyInput(
			s,
			normalizeMouse({ pixel: { x: 1, y: 1 }, button: 'right' }),
		);
		expect(cellAt(s, 0, 0).bg).toBe(''); // punched, not refused
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
