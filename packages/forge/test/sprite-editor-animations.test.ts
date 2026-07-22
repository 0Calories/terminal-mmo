import { describe, expect, test } from 'bun:test';
import { findFrame, parseSpriteFile, validateSpriteRole } from '@mmo/render';
import {
	addFrameToAnimation,
	animationFrames,
	animationNames,
	cloneFrameToAnimation,
	createAnimation,
	deleteAnimation,
	initSpriteEditor,
	paintPixel,
	readPixel,
	redoEdit,
	reorderFrame,
	type SpriteEditorState,
	saveResult,
	setAnimationFps,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'form'));
}

describe('completed Animation authoring', () => {
	test('creating, drawing, cloning, reordering and timing an Animation survives save and parse', () => {
		let state = createAnimation(formState(), 'cheer');
		state = paintPixel(state, 1, 1);
		state = cloneFrameToAnimation(state, 'cheer');
		state = paintPixel(state, 4, 0);
		state = reorderFrame(state, 'cheer', 1, -1);
		state = setAnimationFps(state, 'cheer', 8);

		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const parsed = parseSpriteFile(text, 'test').doc;
		if (parsed === null)
			throw new Error('saved Animation document did not parse');
		const cheer = parsed.animations.find(
			(animation) => animation.name === 'cheer',
		);
		expect(cheer?.fps).toBe(8);
		expect(cheer?.frames).toHaveLength(2);
		expect(findFrame(parsed, 'cheer 0')?.frame.rows.join('')).not.toBe(
			findFrame(parsed, 'cheer 1')?.frame.rows.join(''),
		);
		expect(readPixel({ ...state, doc: parsed, frame: 'cheer 0' }, 4, 0)).toBe(
			true,
		);
	});

	test('adding a blank Frame and cloning an authored Frame produce distinct completed outcomes', () => {
		let state = createAnimation(formState(), 'cheer');
		state = paintPixel(state, 1, 1);
		const cloned = cloneFrameToAnimation(state, 'cheer');
		const added = addFrameToAnimation(state, 'cheer');

		expect(readPixel(cloned, 1, 1)).toBe(true);
		expect(readPixel(added, 1, 1)).toBe(false);
	});

	test('an Animation creation is undoable and redoable as one operation', () => {
		let state = createAnimation(formState(), 'cheer');
		expect(animationNames(state)).toContain('cheer');
		state = undoEdit(state);
		expect(animationNames(state)).not.toContain('cheer');
		state = redoEdit(state);
		expect(animationNames(state)).toContain('cheer');
	});

	test('deleting an Animation removes all of its Frames and undo restores them', () => {
		let state = createAnimation(formState(), 'cheer');
		state = addFrameToAnimation(state, 'cheer');
		const authored = state.doc;
		state = deleteAnimation(state, 'cheer');

		expect(animationNames(state)).not.toContain('cheer');
		expect(animationFrames(state, 'cheer')).toEqual([]);
		expect(undoEdit(state).doc).toEqual(authored);
	});

	test('clearing authored fps returns serialization to the default timing', () => {
		let state = setAnimationFps(formState(), 'walk', 8);
		state = setAnimationFps(state, 'walk', null);
		const parsed = parseSpriteFile(saveResult(state).text, 'test').doc;
		if (parsed === null)
			throw new Error('saved Animation document did not parse');
		expect(
			parsed.animations.find((a) => a.name === 'walk')?.fps,
		).toBeUndefined();
	});
});

describe('Animation format and validation laws', () => {
	test.each([
		[
			'duplicate name',
			(state: SpriteEditorState) => createAnimation(state, 'idle'),
		],
		[
			'illegal name',
			(state: SpriteEditorState) => createAnimation(state, 'bad name!'),
		],
		[
			'unknown Frame target',
			(state: SpriteEditorState) => addFrameToAnimation(state, 'missing'),
		],
		[
			'out-of-range reorder',
			(state: SpriteEditorState) => reorderFrame(state, 'idle', 0, 1),
		],
		[
			'non-positive fps',
			(state: SpriteEditorState) => setAnimationFps(state, 'walk', 0),
		],
	] as const)('%s cannot alter the authored document', (_, operation) => {
		const before = formState();
		expect(operation(before).doc).toBe(before.doc);
	});

	test('the final Animation cannot be deleted', () => {
		const before = initSpriteEditor(emptySpriteDoc('test', 'hat'));
		expect(deleteAnimation(before, 'idle').doc).toBe(before.doc);
	});

	test('role validation reports a deleted required Animation', () => {
		const state = deleteAnimation(formState(), 'walk');
		const errors = validateSpriteRole(state.doc, 'forms').filter(
			(diagnostic) => diagnostic.severity === 'error',
		);
		expect(
			errors.some((diagnostic) => diagnostic.message.includes("'walk'")),
		).toBe(true);
	});
});
