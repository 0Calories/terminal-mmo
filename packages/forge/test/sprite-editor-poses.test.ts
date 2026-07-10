// Headless tests for the Sprite editor's pose-management ops (issue #339):
// create/switch/delete poses, add/reorder frames within a pose, per-pose fps,
// and the role-required-pose/anchor hints. Every mutation is undoable.
import { describe, expect, test } from 'bun:test';
import {
	addFrameToPose,
	createPose,
	currentFrame,
	deletePose,
	frameNames,
	initSpriteEditor,
	poseFrames,
	poseNames,
	redoEdit,
	reorderFrame,
	type SpriteEditorState,
	selectPose,
	setPoseFps,
	undoEdit,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import {
	missingRequiredAnchors,
	missingRequiredPoses,
} from '../src/sprite-editor/view';

function formState(): SpriteEditorState {
	return initSpriteEditor(emptySpriteDoc('buddy', 'form'));
}

describe('createPose', () => {
	test('adds a fresh single-frame pose and switches to it', () => {
		const s = createPose(formState(), 'cheer');
		expect(s.feedback).toBe('');
		expect(poseNames(s)).toContain('cheer');
		expect(poseFrames(s, 'cheer')).toEqual(['cheer']);
		expect(frameNames(s)).toContain('cheer');
		expect(s.pose).toBe('cheer');
		expect(s.frame).toBe('cheer');
	});

	test('the fresh frame matches the canvas extent and is blank', () => {
		const s = createPose(formState(), 'cheer');
		const f = currentFrame(s);
		expect(f.rows.length).toBeGreaterThan(0);
		expect(f.rows.every((r) => r.trim() === '')).toBe(true);
	});

	test('refuses a duplicate pose name', () => {
		const s = createPose(formState(), 'idle');
		expect(s.feedback).not.toBe('');
		expect(poseNames(s).filter((p) => p === 'idle')).toHaveLength(1);
	});

	test('refuses an illegal name', () => {
		const s = createPose(formState(), 'bad name!');
		expect(s.feedback).not.toBe('');
		expect(poseNames(s)).not.toContain('bad name!');
	});

	test('is undoable', () => {
		const before = formState();
		const s = createPose(before, 'cheer');
		const back = undoEdit(s);
		expect(poseNames(back)).not.toContain('cheer');
		const fwd = redoEdit(back);
		expect(poseNames(fwd)).toContain('cheer');
	});
});

describe('addFrameToPose', () => {
	test('appends a fresh frame to the pose and selects it', () => {
		let s = createPose(formState(), 'cheer');
		s = addFrameToPose(s, 'cheer');
		expect(s.feedback).toBe('');
		expect(poseFrames(s, 'cheer')).toHaveLength(2);
		// The new frame is now current and exists as a frame section.
		expect(frameNames(s)).toContain(s.frame);
		expect(poseFrames(s, 'cheer')).toContain(s.frame);
	});

	test('refuses an unknown pose', () => {
		const s = addFrameToPose(formState(), 'nope');
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		let s = createPose(formState(), 'cheer');
		const before = poseFrames(s, 'cheer').length;
		s = addFrameToPose(s, 'cheer');
		s = undoEdit(s);
		expect(poseFrames(s, 'cheer')).toHaveLength(before);
	});
});

describe('deletePose', () => {
	test('removes the pose entry and garbage-collects its orphaned frames', () => {
		const s = deletePose(formState(), 'walkB');
		expect(s.feedback).toBe('');
		expect(poseNames(s)).not.toContain('walkB');
		// walkB's frame was referenced by no other pose, so its section is gone too.
		expect(frameNames(s)).not.toContain('walkB');
	});

	test('keeps a frame that another pose still references', () => {
		// Make idle and a second pose share the same frame, then delete the second.
		let s = createPose(formState(), 'wave');
		// wave now owns frame 'wave'; point a new pose at it too via addFrameToPose
		// then delete one — the shared frame must survive.
		s = { ...s, doc: { ...s.doc, poses: { ...s.doc.poses, alias: ['wave'] } } };
		s = deletePose(s, 'alias');
		expect(poseNames(s)).not.toContain('alias');
		expect(frameNames(s)).toContain('wave');
	});

	test('moves off a deleted current pose', () => {
		let s = selectPose(formState(), 'walkB');
		expect(s.pose).toBe('walkB');
		s = deletePose(s, 'walkB');
		expect(poseNames(s)).toContain(s.pose);
		expect(frameNames(s)).toContain(s.frame);
	});

	test('refuses deleting the last pose', () => {
		let s = initSpriteEditor(emptySpriteDoc('cap', 'hat'));
		s = deletePose(s, 'idle');
		expect(s.feedback).not.toBe('');
		expect(poseNames(s)).toContain('idle');
	});

	test('is undoable', () => {
		const s = deletePose(formState(), 'walkB');
		const back = undoEdit(s);
		expect(poseNames(back)).toContain('walkB');
		expect(frameNames(back)).toContain('walkB');
	});
});

describe('selectPose', () => {
	test('switches current pose and lands on its first frame', () => {
		const s = selectPose(formState(), 'walkA');
		expect(s.pose).toBe('walkA');
		expect(s.frame).toBe('walkA');
	});

	test('refuses an unknown pose', () => {
		const s = selectPose(formState(), 'nope');
		expect(s.feedback).not.toBe('');
	});
});

describe('reorderFrame', () => {
	test('swaps adjacent frames within a pose', () => {
		let s = createPose(formState(), 'combo'); // combo:[combo]
		s = addFrameToPose(s, 'combo');
		const names = poseFrames(s, 'combo');
		expect(names).toHaveLength(2);
		s = reorderFrame(s, 'combo', 0, 1);
		expect(poseFrames(s, 'combo')).toEqual([names[1], names[0]]);
	});

	test('refuses moving out of range', () => {
		const s = reorderFrame(formState(), 'idle', 0, 1);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		let s = createPose(formState(), 'combo');
		s = addFrameToPose(s, 'combo');
		const before = poseFrames(s, 'combo');
		s = reorderFrame(s, 'combo', 0, 1);
		s = undoEdit(s);
		expect(poseFrames(s, 'combo')).toEqual(before);
	});
});

describe('setPoseFps', () => {
	test('sets a positive fps', () => {
		const s = setPoseFps(formState(), 'walkA', 8);
		expect(s.feedback).toBe('');
		expect(s.doc.fps.walkA).toBe(8);
	});

	test('null clears the fps back to the default', () => {
		let s = setPoseFps(formState(), 'walkA', 8);
		s = setPoseFps(s, 'walkA', null);
		expect(s.doc.fps.walkA).toBeUndefined();
	});

	test('refuses a non-positive fps', () => {
		const s = setPoseFps(formState(), 'walkA', 0);
		expect(s.feedback).not.toBe('');
	});

	test('refuses an unknown pose', () => {
		const s = setPoseFps(formState(), 'nope', 8);
		expect(s.feedback).not.toBe('');
	});

	test('is undoable', () => {
		const s = setPoseFps(formState(), 'walkA', 8);
		const back = undoEdit(s);
		expect(back.doc.fps.walkA).toBeUndefined();
	});
});

describe('required-pose/anchor hints', () => {
	test('a fresh form template satisfies its required poses and anchors', () => {
		const s = formState();
		expect(missingRequiredPoses(s.doc, 'form')).toEqual([]);
		expect(missingRequiredAnchors(s.doc, 'form')).toEqual([]);
	});

	test('deleting a required pose surfaces it as missing (allowed, hinted)', () => {
		const s = deletePose(formState(), 'walkB');
		expect(s.feedback).toBe(''); // allowed, not refused
		expect(missingRequiredPoses(s.doc, 'form')).toContain('walkB');
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
