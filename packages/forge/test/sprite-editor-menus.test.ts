// Headless tests for the pose- and anchor-menu reducers (issue #339).
import { describe, expect, test } from 'bun:test';
import {
	anchorMenuKey,
	type MenuKey,
	openAnchorMenu,
	openPoseMenu,
	type PoseRow,
	poseMenuKey,
	syncPoseMenu,
} from '../src/sprite-editor/menus';

const ch = (c: string): MenuKey => ({ name: 'char', char: c });
const k = (name: string): MenuKey => ({ name });

// Narrow a still-open menu (the reducers return `null` only when the overlay
// closes; these flows stay open until the asserted step).
function open<T>(menu: T | null): T {
	if (menu === null) throw new Error('expected the menu to stay open');
	return menu;
}

const POSES: PoseRow[] = [
	{ name: 'idle', frameCount: 1, fps: null },
	{ name: 'walkA', frameCount: 1, fps: null },
	{ name: 'cheer', frameCount: 2, fps: 8 },
];

describe('pose menu', () => {
	test('opens on the current pose', () => {
		const m = openPoseMenu(POSES, 'walkA');
		expect(m.index).toBe(1);
	});

	test('enter emits a switch action', () => {
		const m = openPoseMenu(POSES, 'idle');
		const r = poseMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'switch', pose: 'idle' });
		expect(r.menu).toBeNull();
	});

	test('c → type → enter emits create', () => {
		let m = openPoseMenu(POSES, 'idle');
		m = open(poseMenuKey(m, ch('c')).menu);
		expect(m.input?.mode).toBe('create');
		m = open(poseMenuKey(m, ch('w')).menu);
		m = open(poseMenuKey(m, ch('a')).menu);
		m = open(poseMenuKey(m, ch('v')).menu);
		m = open(poseMenuKey(m, ch('e')).menu);
		const r = poseMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'create', name: 'wave' });
	});

	test('d emits delete of the highlighted pose', () => {
		const m = openPoseMenu(POSES, 'cheer');
		const r = poseMenuKey(m, ch('d'));
		expect(r.action).toEqual({ type: 'delete', pose: 'cheer' });
	});

	test('reorder uses the frame cursor', () => {
		let m = openPoseMenu(POSES, 'cheer'); // index 2, 2 frames
		m = open(poseMenuKey(m, k('right')).menu); // frameIndex → 1
		const r = poseMenuKey(m, ch('<'));
		expect(r.action).toEqual({
			type: 'reorder',
			pose: 'cheer',
			index: 1,
			delta: -1,
		});
	});

	test('f → digits → enter emits setFps', () => {
		let m = openPoseMenu(POSES, 'walkA');
		m = open(poseMenuKey(m, ch('f')).menu);
		m = open(poseMenuKey(m, ch('1')).menu);
		m = open(poseMenuKey(m, ch('2')).menu);
		const r = poseMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'setFps', pose: 'walkA', fps: 12 });
	});

	test('f → empty → enter clears fps', () => {
		let m = openPoseMenu(POSES, 'idle');
		m = open(poseMenuKey(m, ch('f')).menu);
		const r = poseMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'setFps', pose: 'idle', fps: null });
	});

	test('syncPoseMenu keeps the selection on a live pose', () => {
		const m = openPoseMenu(POSES, 'cheer'); // index 2
		const next = syncPoseMenu(m, POSES.slice(0, 2)); // cheer removed
		expect(next.index).toBe(1);
	});
});

describe('anchor menu', () => {
	const NAMES = ['grip', 'head'];

	test('enter on a name emits select with the current scope', () => {
		const m = openAnchorMenu(NAMES, 'grip', 'doc');
		const r = anchorMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'select', name: 'grip', scope: 'doc' });
	});

	test('s toggles scope', () => {
		let m = openAnchorMenu(NAMES, 'grip', 'doc');
		m = open(anchorMenuKey(m, ch('s')).menu);
		expect(m.scope).toBe('frame');
	});

	test('the trailing + new row opens a name input', () => {
		let m = openAnchorMenu(NAMES, 'grip', 'doc');
		m = open(anchorMenuKey(m, k('down')).menu); // head
		m = open(anchorMenuKey(m, k('down')).menu); // + new (index 2)
		expect(m.index).toBe(2);
		m = open(anchorMenuKey(m, k('enter')).menu);
		expect(m.input).not.toBeNull();
		m = open(anchorMenuKey(m, ch('m')).menu);
		m = open(anchorMenuKey(m, ch('u')).menu);
		const r = anchorMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'select', name: 'mu', scope: 'doc' });
	});
});
