import { describe, expect, test } from 'bun:test';
import {
	applyInput,
	normalizeKey,
	normalizeMouse,
} from '../src/sprite-editor/input';
import {
	colorInk,
	constrainSquare,
	currentFrame,
	ellipsePixels,
	frameExtent,
	initSpriteEditor,
	linePixels,
	type Point,
	readPixel,
	rectPixels,
	type SpriteEditorState,
	setInk,
	setTool,
	toggleShapeMode,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

type ShapeTool = 'line' | 'rect' | 'ellipse';
type Device = 'mouse' | 'keyboard';

function blankState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'hat'));
}

const pointSet = (points: readonly Point[]): Set<string> =>
	new Set(points.map(({ x, y }) => `${x},${y}`));

function drawShape(
	tool: ShapeTool,
	device: Device,
	to = { x: 4, y: 2 },
	shift = false,
): SpriteEditorState {
	let state = setTool(setInk(blankState(), colorInk('g')), tool);
	if (device === 'mouse') {
		state = applyInput(
			state,
			normalizeMouse({
				pixel: { x: 0, y: 0 },
				button: 'left',
				phase: 'down',
			}),
		);
		return applyInput(
			state,
			normalizeMouse({ pixel: to, button: 'left', phase: 'up', shift }),
		);
	}

	state = applyInput(
		state,
		normalizeKey({ pixel: { x: 0, y: 0 }, paint: 'ink', phase: 'toggle' }),
	);
	state = applyInput(
		state,
		normalizeKey({ pixel: to, paint: 'none', phase: 'move', shift }),
	);
	return applyInput(
		state,
		normalizeKey({ pixel: to, paint: 'ink', phase: 'toggle', shift }),
	);
}

describe('shape geometry laws', () => {
	test.each([
		[{ x: 0, y: 1 }, { x: 3, y: 1 }, 4],
		[{ x: 2, y: 0 }, { x: 2, y: 2 }, 3],
		[{ x: 0, y: 0 }, { x: 3, y: 3 }, 4],
		[{ x: 4, y: 4 }, { x: 4, y: 4 }, 1],
		[{ x: 0, y: 0 }, { x: 4, y: 2 }, 5],
	] as const)('a line from %o to %o includes both endpoints in %i major-axis steps', (from, to, length) => {
		const pixels = linePixels(from, to);
		expect(pixels).toHaveLength(length);
		expect(pixels[0]).toEqual(from);
		expect(pixels.at(-1)).toEqual(to);
	});

	test('rectangle fill covers its box while outline leaves the center hollow, independent of drag direction', () => {
		const outline = pointSet(rectPixels({ x: 0, y: 0 }, { x: 2, y: 2 }, false));
		const filled = pointSet(rectPixels({ x: 2, y: 2 }, { x: 0, y: 0 }, true));

		expect(outline.has('1,1')).toBe(false);
		expect(filled.has('1,1')).toBe(true);
		expect(filled.size).toBe(9);
		for (const pixel of outline) expect(filled.has(pixel)).toBe(true);
	});

	test('ellipse outline is a hollow subset of fill and collapsed axes become lines', () => {
		const outline = pointSet(
			ellipsePixels({ x: 0, y: 0 }, { x: 4, y: 4 }, false),
		);
		const filled = pointSet(
			ellipsePixels({ x: 0, y: 0 }, { x: 4, y: 4 }, true),
		);
		expect(outline.has('2,2')).toBe(false);
		expect(filled.has('2,2')).toBe(true);
		for (const pixel of outline) expect(filled.has(pixel)).toBe(true);

		expect(
			pointSet(ellipsePixels({ x: 0, y: 0 }, { x: 3, y: 0 }, false)),
		).toEqual(pointSet(linePixels({ x: 0, y: 0 }, { x: 3, y: 0 })));
	});

	test.each([
		[
			{ x: 10, y: 2 },
			{ x: 10, y: 5 },
		],
		[
			{ x: 2, y: 4 },
			{ x: 8, y: 4 },
		],
		[
			{ x: -4, y: 3 },
			{ x: -6, y: 3 },
		],
		[
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		],
	] as const)('visual-square constraint maps %o to %o', (drag, expected) => {
		expect(constrainSquare({ x: 0, y: 0 }, drag)).toEqual(expected);
	});
});

describe('completed shape operations', () => {
	test.each([
		'line',
		'rect',
		'ellipse',
	] as const)('%s produces the same saved art from mouse and keyboard gestures', (tool) => {
		const mouse = drawShape(tool, 'mouse');
		const keyboard = drawShape(tool, 'keyboard');
		expect(mouse.doc).toEqual(keyboard.doc);
	});

	test('one undo removes an entire committed shape', () => {
		const drawn = drawShape('line', 'mouse', { x: 4, y: 0 });
		for (let x = 0; x <= 4; x++) expect(readPixel(drawn, x, 0)).toBe(true);
		const undone = undoEdit(drawn);
		for (let x = 0; x <= 4; x++) expect(readPixel(undone, x, 0)).toBe(false);
	});

	test.each([
		'rect',
		'ellipse',
	] as const)('a completed filled %s includes its center while its outline does not', (tool) => {
		let filledStart = setTool(setInk(blankState(), colorInk('g')), tool);
		filledStart = toggleShapeMode(filledStart);
		filledStart = applyInput(
			filledStart,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left', phase: 'down' }),
		);
		const filled = applyInput(
			filledStart,
			normalizeMouse({ pixel: { x: 4, y: 4 }, button: 'left', phase: 'up' }),
		);
		const outline = drawShape(tool, 'mouse', { x: 4, y: 4 });

		expect(readPixel(filled, 2, 2)).toBe(true);
		expect(readPixel(outline, 2, 2)).toBe(false);
	});

	test('a constrained rectangle completes with the terminal Pixel aspect ratio', () => {
		const state = drawShape('rect', 'mouse', { x: 6, y: 1 }, true);
		expect(readPixel(state, 6, 3)).toBe(true);
		expect(readPixel(state, 6, 4)).toBe(false);
	});

	test('shape drawing clips to the Frame without changing its extent', () => {
		const before = frameExtent(currentFrame(blankState()));
		const state = drawShape('rect', 'mouse', { x: 20, y: 20 });
		expect(frameExtent(currentFrame(state))).toEqual(before);
	});

	test('a secondary-button rectangle erases authored Pixels inside its outline', () => {
		let state = setTool(setInk(blankState(), colorInk('g')), 'fill');
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'left' }),
		);
		state = setTool(state, 'rect');
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 0, y: 0 }, button: 'right', phase: 'down' }),
		);
		state = applyInput(
			state,
			normalizeMouse({ pixel: { x: 2, y: 2 }, button: 'right', phase: 'up' }),
		);

		expect(readPixel(state, 0, 0)).toBe(false);
		expect(readPixel(state, 1, 1)).toBe(true);
	});
});
