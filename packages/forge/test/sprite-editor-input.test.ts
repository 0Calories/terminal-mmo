import { describe, expect, test } from 'bun:test';
import {
	applyInput,
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
	return setTool(initSpriteEditor(emptySpriteDoc('test', 'hat')), 'paint');
}

describe('authoring through the input seam', () => {
	test('mouse and keyboard complete the same drawing operation', () => {
		const start = setInk(blankState(), colorInk('g'));
		const mouse = applyInput(
			start,
			normalizeMouse({ pixel: { x: 2, y: 1 }, button: 'left' }),
		);
		const keyboard = applyInput(
			start,
			normalizeKey({ pixel: { x: 2, y: 1 }, paint: 'ink' }),
		);

		expect(mouse.doc).toEqual(keyboard.doc);
		expect(cellAt(mouse, 1, 0)).toMatchObject({ glyph: '▖', fg: 'g' });
	});

	test('a mouse drag through visited Pixels completes a continuous stroke', () => {
		let state = setInk(blankState(), colorInk('g'));
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 1, y: 0 }, button: 'left', phase: 'drag' }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left', phase: 'drag' }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 3, y: 0 }, button: 'left', phase: 'up' }),
		);

		for (let x = 0; x <= 3; x++) expect(readPixel(state, x, 0)).toBe(true);
	});

	test.each([
		[
			'secondary paint',
			(state: SpriteEditorState) =>
				applyInput(
					state,
					normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right' }),
				),
		],
		[
			'erase tool',
			(state: SpriteEditorState) =>
				applyInput(
					setTool(state, 'erase'),
					normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
				),
		],
	] as const)('%s removes authored art', (_, erase) => {
		const painted = applyInput(
			blankState(),
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		expect(readPixel(erase(painted), 0, 0)).toBe(false);
	});

	test('eyedropping a color changes the next completed draw without changing existing art', () => {
		let state = setInk(blankState(), colorInk('g'));
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		state = setInk(state, colorInk('m'));
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', alt: true }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 2, y: 0 }, button: 'left' }),
		);

		expect(cellAt(state, 0, 0).fg).toBe('g');
		expect(cellAt(state, 1, 0).fg).toBe('g');
	});
});
