// Headless tests for the Sprite editor's anchor model (ADR 0036): scope is
// frame IDENTITY — an anchor edit on the Default frame (first in file) edits
// the file-level anchors, on any other frame it authors that frame's override.
// Doc-level anchors can be deleted (guarded for role-required names); override
// removal falls back to the default. Every mutation is undoable.
import { describe, expect, test } from 'bun:test';
import { allFrames, findFrame } from '@mmo/render';
import {
	anchorMarkers,
	anchorScopeFor,
	deleteAnchor,
	initSpriteEditor,
	placeAnchor,
	removeAnchorOverride,
	type SpriteEditorState,
	selectFrame,
	setAnchorName,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('buddy', 'form'));
}

describe('anchorScopeFor — frame identity decides (ADR 0036)', () => {
	test('the Default frame (first in file) edits doc anchors; others author overrides', () => {
		const s = formState();
		expect(s.frame).toBe('idle'); // the template's Default frame
		expect(anchorScopeFor(s)).toBe('doc');
		expect(anchorScopeFor(selectFrame(s, 'walk 0'))).toBe('frame');
	});
});

describe('placeAnchor — scope derived from the current frame', () => {
	test('on the Default frame it sets the doc-level anchor', () => {
		const s = placeAnchor(formState(), 'grip', 3, 1);
		expect(s.feedback).toBe('');
		expect(s.doc.anchors.grip).toEqual({ x: 3, y: 1 });
		// No override was authored anywhere.
		expect(allFrames(s.doc).every((f) => f.anchors.grip === undefined)).toBe(
			true,
		);
	});

	test("on any other frame it authors that frame's override only", () => {
		let s = selectFrame(formState(), 'walk 0');
		const docGrip = s.doc.anchors.grip;
		s = placeAnchor(s, 'grip', 5, 2);
		expect(s.feedback).toBe('');
		const walk0 = findFrame(s.doc, 'walk 0')?.frame;
		expect(walk0?.anchors.grip).toEqual({ x: 5, y: 2 });
		expect(s.doc.anchors.grip).toEqual(docGrip); // doc level untouched
		const idle = findFrame(s.doc, 'idle')?.frame;
		expect(idle?.anchors.grip).toBeUndefined();
	});

	test('allows an anchor outside the art grid, warning on the status line (#402)', () => {
		const s = placeAnchor(formState(), 'grip', 99, 99);
		expect(s.feedback).toContain('outside the art bounds');
		expect(s.doc.anchors.grip).toEqual({ x: 99, y: 99 });
	});

	test('refuses an illegal anchor name', () => {
		const s = placeAnchor(formState(), 'bad name', 1, 1);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		const before = formState();
		const s = placeAnchor(before, 'grip', 3, 1);
		const back = undoEdit(s);
		expect(back.doc.anchors.grip).toEqual(before.doc.anchors.grip);
	});
});

describe('deleteAnchor — doc-level, guarded (ADR 0036)', () => {
	test('removes the doc anchor and any per-frame overrides of that name', () => {
		let s = placeAnchor(formState(), 'tail', 1, 1); // a custom doc anchor
		s = selectFrame(s, 'walk 0');
		s = placeAnchor(s, 'tail', 2, 2); // an override of it
		s = deleteAnchor(s, 'tail', ['grip', 'head']);
		expect(s.feedback).toBe('');
		expect(s.doc.anchors.tail).toBeUndefined();
		expect(allFrames(s.doc).every((f) => f.anchors.tail === undefined)).toBe(
			true,
		);
	});

	test('refuses deleting a role-required anchor', () => {
		const s = deleteAnchor(formState(), 'grip', ['grip', 'head']);
		expect(s.feedback).not.toBe('');
		expect(s.doc.anchors.grip).toBeDefined();
	});

	test('refuses an unknown anchor', () => {
		const s = deleteAnchor(formState(), 'nope', []);
		expect(s.feedback).not.toBe('');
	});

	test('is one undoable step', () => {
		let s = placeAnchor(formState(), 'tail', 1, 1);
		s = selectFrame(s, 'walk 0');
		s = placeAnchor(s, 'tail', 2, 2);
		const before = s;
		s = deleteAnchor(s, 'tail', []);
		const back = undoEdit(s);
		expect(back.doc.anchors.tail).toEqual(before.doc.anchors.tail);
		expect(findFrame(back.doc, 'walk 0')?.frame.anchors.tail).toEqual({
			x: 2,
			y: 2,
		});
	});
});

describe('removeAnchorOverride', () => {
	test('drops the override, falling back to the doc position', () => {
		let s = selectFrame(formState(), 'walk 0');
		const docGrip = s.doc.anchors.grip;
		s = placeAnchor(s, 'grip', 5, 2);
		s = removeAnchorOverride(s, 'grip');
		expect(s.feedback).toBe('');
		const walk0 = findFrame(s.doc, 'walk 0')?.frame;
		expect(walk0?.anchors.grip).toBeUndefined();
		const grip = anchorMarkers(s).find((m) => m.name === 'grip');
		expect(grip).toEqual({
			name: 'grip',
			x: docGrip.x,
			y: docGrip.y,
			overridden: false,
		});
	});

	test('refuses when there is no override to remove', () => {
		const s = removeAnchorOverride(formState(), 'grip');
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		let s = selectFrame(formState(), 'walk 0');
		s = placeAnchor(s, 'grip', 5, 2);
		const withOverride = s;
		s = removeAnchorOverride(s, 'grip');
		s = undoEdit(s);
		const walk0 = findFrame(s.doc, 'walk 0')?.frame;
		expect(walk0?.anchors.grip).toEqual(
			findFrame(withOverride.doc, 'walk 0')?.frame.anchors.grip,
		);
	});
});

describe('anchorMarkers', () => {
	test('overlays frame overrides over doc anchors, frame wins + tagged', () => {
		let s = selectFrame(formState(), 'walk 0');
		s = placeAnchor(s, 'grip', 5, 2);
		const markers = anchorMarkers(s);
		const grip = markers.find((m) => m.name === 'grip');
		const head = markers.find((m) => m.name === 'head');
		expect(grip).toEqual({ name: 'grip', x: 5, y: 2, overridden: true });
		// head has no override, so it comes from the doc level.
		expect(head?.overridden).toBe(false);
	});
});

describe('anchor tool selection', () => {
	test('setAnchorName validates the charset', () => {
		expect(setAnchorName(formState(), 'muzzle').anchorName).toBe('muzzle');
		expect(setAnchorName(formState(), 'no good').feedback).not.toBe('');
	});
});
