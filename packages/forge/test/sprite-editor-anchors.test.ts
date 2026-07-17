// Headless tests for the Sprite editor's anchor tool (issue #339): place/move a
// named anchor at doc scope or as a per-frame override, remove an override
// (falling back to the doc position), and the effective-anchor read the canvas
// draws. Every mutation is undoable.
import { describe, expect, test } from 'bun:test';
import {
	anchorMarkers,
	initSpriteEditor,
	placeAnchor,
	removeAnchorOverride,
	type SpriteEditorState,
	selectFrame,
	setAnchorName,
	setAnchorScope,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('buddy', 'form'));
}

describe('placeAnchor — doc scope', () => {
	test('sets a doc-level anchor at the cell', () => {
		const s = placeAnchor(formState(), 'grip', 3, 1, 'doc');
		expect(s.feedback).toBe('');
		expect(s.doc.anchors.grip).toEqual({ x: 3, y: 1 });
	});

	test('allows an anchor outside the art grid, warning on the status line (#402)', () => {
		const s = placeAnchor(formState(), 'grip', 99, 99, 'doc');
		// Out-of-bounds anchors WARN but are never rejected (ADR 0031, #402): the
		// anchor still lands, and the status line explains it.
		expect(s.feedback).toContain('outside the art bounds');
		expect(s.doc.anchors.grip).toEqual({ x: 99, y: 99 });
	});

	test('refuses an illegal anchor name', () => {
		const s = placeAnchor(formState(), 'bad name', 1, 1, 'doc');
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		const before = formState();
		const s = placeAnchor(before, 'grip', 3, 1, 'doc');
		const back = undoEdit(s);
		expect(back.doc.anchors.grip).toEqual(before.doc.anchors.grip);
	});
});

describe('placeAnchor — per-frame override', () => {
	test('sets an override on the current frame only', () => {
		let s = selectFrame(formState(), 'walk-0');
		s = placeAnchor(s, 'grip', 5, 2, 'frame');
		expect(s.feedback).toBe('');
		const walk0 = s.doc.frames.find((f) => f.name === 'walk-0');
		expect(walk0?.anchors.grip).toEqual({ x: 5, y: 2 });
		// idle keeps only the doc-level anchor, no override.
		const idle = s.doc.frames.find((f) => f.name === 'idle');
		expect(idle?.anchors.grip).toBeUndefined();
	});
});

describe('removeAnchorOverride', () => {
	test('drops the override, falling back to the doc position', () => {
		let s = selectFrame(formState(), 'walk-0');
		const docGrip = s.doc.anchors.grip;
		s = placeAnchor(s, 'grip', 5, 2, 'frame');
		s = removeAnchorOverride(s, 'grip');
		expect(s.feedback).toBe('');
		const walk0 = s.doc.frames.find((f) => f.name === 'walk-0');
		expect(walk0?.anchors.grip).toBeUndefined();
		// The effective marker is back to the doc-level position.
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
		let s = selectFrame(formState(), 'walk-0');
		s = placeAnchor(s, 'grip', 5, 2, 'frame');
		const withOverride = s;
		s = removeAnchorOverride(s, 'grip');
		s = undoEdit(s);
		const walk0 = s.doc.frames.find((f) => f.name === 'walk-0');
		expect(walk0?.anchors.grip).toEqual(
			withOverride.doc.frames.find((f) => f.name === 'walk-0')?.anchors.grip,
		);
	});
});

describe('anchorMarkers', () => {
	test('overlays frame overrides over doc anchors, frame wins + tagged', () => {
		let s = selectFrame(formState(), 'walk-0');
		s = placeAnchor(s, 'grip', 5, 2, 'frame');
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

	test('setAnchorScope toggles doc/frame', () => {
		expect(setAnchorScope(formState(), 'frame').anchorScope).toBe('frame');
	});
});
