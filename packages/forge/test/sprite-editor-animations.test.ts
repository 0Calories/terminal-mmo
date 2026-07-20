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
	paintPixel,
	readPixel,
	redoEdit,
	reorderFrame,
	type SpriteEditorState,
	selectAnimation,
	selectFrame,
	setAnimationFps,
	undoEdit,
} from '../src/sprite-editor/state';

// v2 (ADR 0037): fps lives per-animation on the ordered animations array, not a
// top-level `doc.fps` map. Read a named animation's authored fps (undefined when
// cleared) straight off its entry.
function fpsOf(s: SpriteEditorState, animation: string): number | undefined {
	return s.doc.animations.find((a) => a.name === animation)?.fps;
}

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
		const s = deleteAnimation(formState(), 'walk');
		expect(s.feedback).toBe('');
		expect(animationNames(s)).not.toContain('walk');
		// walk's frames belong to walk alone (v2: frames are index-bound to one
		// animation), so their labels go with it.
		expect(frameNames(s)).not.toContain('walk 0');
		expect(frameNames(s)).not.toContain('walk 1');
	});

	test('deleting one animation leaves other animations’ frames intact', () => {
		// v2 has no cross-animation frame sharing (frames are index-bound to a
		// single animation, ADR 0037); deleting one animation must not disturb the
		// frames of any other. Add two independent animations, delete one, and the
		// survivor's frame stays.
		let s = createAnimation(formState(), 'wave'); // wave: [wave]
		s = createAnimation(s, 'flex'); // flex: [flex]
		s = deleteAnimation(s, 'flex');
		expect(animationNames(s)).not.toContain('flex');
		expect(frameNames(s)).toContain('wave');
	});

	test('moves off a deleted current animation', () => {
		let s = selectAnimation(formState(), 'walk');
		expect(s.animation).toBe('walk');
		s = deleteAnimation(s, 'walk');
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
		const s = deleteAnimation(formState(), 'walk');
		const back = undoEdit(s);
		expect(animationNames(back)).toContain('walk');
		expect(frameNames(back)).toContain('walk 0');
	});
});

describe('selectAnimation', () => {
	test('switches current animation and lands on its first frame', () => {
		const s = selectAnimation(formState(), 'walk');
		expect(s.animation).toBe('walk');
		expect(s.frame).toBe('walk 0');
	});

	test('refuses an unknown animation', () => {
		const s = selectAnimation(formState(), 'nope');
		expect(s.feedback).not.toBe('');
	});
});

describe('reorderFrame', () => {
	test('swaps adjacent frames within an animation', () => {
		let s = createAnimation(formState(), 'combo'); // combo: single frame 'combo'
		s = addFrameToAnimation(s, 'combo'); // combo 0, combo 1; current is 'combo 1'
		expect(animationFrames(s, 'combo')).toEqual(['combo 0', 'combo 1']);
		// v2 frame labels are positional (ADR 0037), so a swap can't be read off the
		// labels — mark the second frame's content and watch it move to index 0.
		s = paintPixel(s, 0, 0); // paints the current frame, 'combo 1'
		expect(readPixel(selectFrame(s, 'combo 1'), 0, 0)).toBe(true);
		expect(readPixel(selectFrame(s, 'combo 0'), 0, 0)).toBe(false);
		s = reorderFrame(s, 'combo', 0, 1);
		expect(animationFrames(s, 'combo')).toEqual(['combo 0', 'combo 1']);
		expect(readPixel(selectFrame(s, 'combo 0'), 0, 0)).toBe(true);
		expect(readPixel(selectFrame(s, 'combo 1'), 0, 0)).toBe(false);
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
		const s = setAnimationFps(formState(), 'walk', 8);
		expect(s.feedback).toBe('');
		expect(fpsOf(s, 'walk')).toBe(8);
	});

	test('null clears the fps back to the default', () => {
		let s = setAnimationFps(formState(), 'walk', 8);
		s = setAnimationFps(s, 'walk', null);
		expect(fpsOf(s, 'walk')).toBeUndefined();
	});

	test('refuses a non-positive fps', () => {
		const s = setAnimationFps(formState(), 'walk', 0);
		expect(s.feedback).not.toBe('');
	});

	test('refuses an unknown animation', () => {
		const s = setAnimationFps(formState(), 'nope', 8);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		const s = setAnimationFps(formState(), 'walk', 8);
		const back = undoEdit(s);
		expect(fpsOf(back, 'walk')).toBeUndefined();
	});
});

describe('required-animation/anchor hints', () => {
	test('a fresh form template satisfies its required animations and anchors', () => {
		const s = formState();
		expect(missingRequiredAnimations(s.doc, 'form')).toEqual([]);
		expect(missingRequiredAnchors(s.doc, 'form')).toEqual([]);
	});

	test('deleting a required animation surfaces it as missing (allowed, hinted)', () => {
		const s = deleteAnimation(formState(), 'walk');
		expect(s.feedback).toBe(''); // allowed, not refused
		expect(missingRequiredAnimations(s.doc, 'form')).toContain('walk');
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
