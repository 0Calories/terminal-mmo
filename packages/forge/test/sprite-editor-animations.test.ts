// Headless tests for the Sprite editor's animation-management ops (issue #339):
// create/switch/delete animations, add/reorder frames within an animation, per-animation fps,
// and the role-required-animation/anchor hints. Every mutation is undoable.
import { describe, expect, test } from 'bun:test';
import {
	addFrameToAnimation,
	animationFrames,
	animationNames,
	createAnimation,
	currentFrame,
	deleteAnimation,
	frameNames,
	initSpriteEditor,
	redoEdit,
	reorderFrame,
	type SpriteEditorState,
	selectAnimation,
	setAnimationFps,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import {
	missingRequiredAnchors,
	missingRequiredAnimations,
} from '../src/sprite-editor/view';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('buddy', 'form'));
}

describe('createAnimation', () => {
	test('adds a fresh single-frame animation and switches to it', () => {
		const s = createAnimation(formState(), 'cheer');
		expect(s.feedback).toBe('');
		expect(animationNames(s)).toContain('cheer');
		expect(animationFrames(s, 'cheer')).toEqual(['cheer']);
		expect(frameNames(s)).toContain('cheer');
		expect(s.animation).toBe('cheer');
		expect(s.frame).toBe('cheer');
	});

	test('the fresh frame matches the canvas extent and is blank', () => {
		const s = createAnimation(formState(), 'cheer');
		const f = currentFrame(s);
		expect(f.rows.length).toBeGreaterThan(0);
		expect(f.rows.every((r) => r.trim() === '')).toBe(true);
	});

	test('refuses a duplicate animation name', () => {
		const s = createAnimation(formState(), 'idle');
		expect(s.feedback).not.toBe('');
		expect(animationNames(s).filter((p) => p === 'idle')).toHaveLength(1);
	});

	test('refuses an illegal name', () => {
		const s = createAnimation(formState(), 'bad name!');
		expect(s.feedback).not.toBe('');
		expect(animationNames(s)).not.toContain('bad name!');
	});

	test('is undoable', () => {
		const before = formState();
		const s = createAnimation(before, 'cheer');
		const back = undoEdit(s);
		expect(animationNames(back)).not.toContain('cheer');
		const fwd = redoEdit(back);
		expect(animationNames(fwd)).toContain('cheer');
	});
});

describe('addFrameToAnimation', () => {
	test('appends a fresh frame to the animation and selects it', () => {
		let s = createAnimation(formState(), 'cheer');
		s = addFrameToAnimation(s, 'cheer');
		expect(s.feedback).toBe('');
		expect(animationFrames(s, 'cheer')).toHaveLength(2);
		// The new frame is now current and exists as a frame section.
		expect(frameNames(s)).toContain(s.frame);
		expect(animationFrames(s, 'cheer')).toContain(s.frame);
	});

	test('refuses an unknown animation', () => {
		const s = addFrameToAnimation(formState(), 'nope');
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		let s = createAnimation(formState(), 'cheer');
		const before = animationFrames(s, 'cheer').length;
		s = addFrameToAnimation(s, 'cheer');
		s = undoEdit(s);
		expect(animationFrames(s, 'cheer')).toHaveLength(before);
	});
});

describe('deleteAnimation', () => {
	test('removes the animation entry and garbage-collects its orphaned frames', () => {
		const s = deleteAnimation(formState(), 'walkB');
		expect(s.feedback).toBe('');
		expect(animationNames(s)).not.toContain('walkB');
		// walkB's frame was referenced by no other animation, so its section is gone too.
		expect(frameNames(s)).not.toContain('walkB');
	});

	test('keeps a frame that another animation still references', () => {
		// Make idle and a second animation share the same frame, then delete the second.
		let s = createAnimation(formState(), 'wave');
		// wave now owns frame 'wave'; point a new animation at it too via addFrameToAnimation
		// then delete one — the shared frame must survive.
		s = {
			...s,
			doc: { ...s.doc, animations: { ...s.doc.animations, alias: ['wave'] } },
		};
		s = deleteAnimation(s, 'alias');
		expect(animationNames(s)).not.toContain('alias');
		expect(frameNames(s)).toContain('wave');
	});

	test('moves off a deleted current animation', () => {
		let s = selectAnimation(formState(), 'walkB');
		expect(s.animation).toBe('walkB');
		s = deleteAnimation(s, 'walkB');
		expect(animationNames(s)).toContain(s.animation);
		expect(frameNames(s)).toContain(s.frame);
	});

	test('refuses deleting the last animation', () => {
		let s = initSpriteEditor(emptySpriteDoc('cap', 'hat'));
		s = deleteAnimation(s, 'idle');
		expect(s.feedback).not.toBe('');
		expect(animationNames(s)).toContain('idle');
	});

	test('is undoable', () => {
		const s = deleteAnimation(formState(), 'walkB');
		const back = undoEdit(s);
		expect(animationNames(back)).toContain('walkB');
		expect(frameNames(back)).toContain('walkB');
	});
});

describe('selectAnimation', () => {
	test('switches current animation and lands on its first frame', () => {
		const s = selectAnimation(formState(), 'walkA');
		expect(s.animation).toBe('walkA');
		expect(s.frame).toBe('walkA');
	});

	test('refuses an unknown animation', () => {
		const s = selectAnimation(formState(), 'nope');
		expect(s.feedback).not.toBe('');
	});
});

describe('reorderFrame', () => {
	test('swaps adjacent frames within an animation', () => {
		let s = createAnimation(formState(), 'combo'); // combo:[combo]
		s = addFrameToAnimation(s, 'combo');
		const names = animationFrames(s, 'combo');
		expect(names).toHaveLength(2);
		s = reorderFrame(s, 'combo', 0, 1);
		expect(animationFrames(s, 'combo')).toEqual([names[1], names[0]]);
	});

	test('refuses moving out of range', () => {
		const s = reorderFrame(formState(), 'idle', 0, 1);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		let s = createAnimation(formState(), 'combo');
		s = addFrameToAnimation(s, 'combo');
		const before = animationFrames(s, 'combo');
		s = reorderFrame(s, 'combo', 0, 1);
		s = undoEdit(s);
		expect(animationFrames(s, 'combo')).toEqual(before);
	});
});

describe('setAnimationFps', () => {
	test('sets a positive fps', () => {
		const s = setAnimationFps(formState(), 'walkA', 8);
		expect(s.feedback).toBe('');
		expect(s.doc.fps.walkA).toBe(8);
	});

	test('null clears the fps back to the default', () => {
		let s = setAnimationFps(formState(), 'walkA', 8);
		s = setAnimationFps(s, 'walkA', null);
		expect(s.doc.fps.walkA).toBeUndefined();
	});

	test('refuses a non-positive fps', () => {
		const s = setAnimationFps(formState(), 'walkA', 0);
		expect(s.feedback).not.toBe('');
	});

	test('refuses an unknown animation', () => {
		const s = setAnimationFps(formState(), 'nope', 8);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		const s = setAnimationFps(formState(), 'walkA', 8);
		const back = undoEdit(s);
		expect(back.doc.fps.walkA).toBeUndefined();
	});
});

describe('required-animation/anchor hints', () => {
	test('a fresh form template satisfies its required animations and anchors', () => {
		const s = formState();
		expect(missingRequiredAnimations(s.doc, 'form')).toEqual([]);
		expect(missingRequiredAnchors(s.doc, 'form')).toEqual([]);
	});

	test('deleting a required animation surfaces it as missing (allowed, hinted)', () => {
		const s = deleteAnimation(formState(), 'walkB');
		expect(s.feedback).toBe(''); // allowed, not refused
		expect(missingRequiredAnimations(s.doc, 'form')).toContain('walkB');
	});

	test('a doc missing a required anchor reports it', () => {
		const s = formState();
		const stripped = {
			...s.doc,
			anchors: { grip: s.doc.anchors.grip },
		};
		expect(missingRequiredAnchors(stripped, 'form')).toContain('head');
	});
});
