import { describe, expect, test } from 'bun:test';
import { allFrames, findFrame, parseSpriteFile } from '@mmo/render';
import {
	deleteAnchor,
	initSpriteEditor,
	placeAnchor,
	redoEdit,
	removeAnchorOverride,
	type SpriteEditorState,
	saveResult,
	selectFrame,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('test', 'form'));
}

describe('completed Anchor operations', () => {
	test('Default-frame and per-Frame Anchor edits survive save and parse at their respective scopes', () => {
		let state = placeAnchor(formState(), 'grip', 3, 1);
		state = selectFrame(state, 'walk 0');
		state = placeAnchor(state, 'grip', 5, 2);

		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const parsed = parseSpriteFile(text, 'test').doc;
		if (parsed === null) throw new Error('saved Anchor document did not parse');
		expect(parsed.anchors.grip).toEqual({ x: 3, y: 1 });
		expect(findFrame(parsed, 'walk 0')?.frame.anchors.grip).toEqual({
			x: 5,
			y: 2,
		});
		expect(findFrame(parsed, 'idle')?.frame.anchors.grip).toBeUndefined();
	});

	test('removing an override restores document-level fallback and is undoable', () => {
		let state = selectFrame(formState(), 'walk 0');
		state = placeAnchor(state, 'grip', 5, 2);
		const withOverride = state.doc;
		state = removeAnchorOverride(state, 'grip');

		expect(findFrame(state.doc, 'walk 0')?.frame.anchors.grip).toBeUndefined();
		state = undoEdit(state);
		expect(state.doc).toEqual(withOverride);
		state = redoEdit(state);
		expect(findFrame(state.doc, 'walk 0')?.frame.anchors.grip).toBeUndefined();
	});

	test('deleting a custom Anchor removes its default and every override as one undoable operation', () => {
		let state = placeAnchor(formState(), 'tail', 1, 1);
		state = placeAnchor(selectFrame(state, 'walk 0'), 'tail', 2, 2);
		const authored = state.doc;
		state = deleteAnchor(state, 'tail', ['grip', 'head']);

		expect(state.doc.anchors.tail).toBeUndefined();
		expect(
			allFrames(state.doc).every((f) => f.anchors.tail === undefined),
		).toBe(true);
		expect(undoEdit(state).doc).toEqual(authored);
	});

	test('an out-of-bounds Anchor remains valid serialized data', () => {
		const state = placeAnchor(formState(), 'grip', 99, 99);
		const { text, diagnostics } = saveResult(state);
		expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		expect(parseSpriteFile(text, 'test').doc?.anchors.grip).toEqual({
			x: 99,
			y: 99,
		});
	});
});

describe('Anchor validation laws', () => {
	test('required Anchors cannot be deleted', () => {
		const state = deleteAnchor(formState(), 'grip', ['grip', 'head']);
		expect(state.doc.anchors.grip).toBeDefined();
		expect(state.feedback).not.toBe('');
	});

	test.each([
		'bad name',
		'',
		'two/parts',
	])('illegal Anchor name %p cannot alter the document', (name) => {
		const before = formState();
		const after = placeAnchor(before, name, 1, 1);
		expect(after.doc).toBe(before.doc);
	});

	test('an override can only be removed from a Frame that authors it', () => {
		const before = formState();
		expect(removeAnchorOverride(before, 'grip').doc).toBe(before.doc);
	});
});
