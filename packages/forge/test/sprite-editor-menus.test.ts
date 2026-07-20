// Headless tests for the animation- and anchor-menu reducers (issue #339).
import { describe, expect, test } from 'bun:test';
import {
	type AnimationRow,
	anchorMenuClick,
	anchorMenuKey,
	animationMenuKey,
	type MenuKey,
	openAnchorMenu,
	openAnimationMenu,
	syncAnimationMenu,
} from '../src/sprite-editor/menus';

const ch = (c: string): MenuKey => ({ name: 'char', char: c });
const k = (name: string): MenuKey => ({ name });

// Narrow a still-open menu (the reducers return `null` only when the overlay
// closes; these flows stay open until the asserted step).
function open<T>(menu: T | null): T {
	if (menu === null) throw new Error('expected the menu to stay open');
	return menu;
}

const ANIMATIONS: AnimationRow[] = [
	{ name: 'idle', frameCount: 1, fps: null },
	{ name: 'walkA', frameCount: 1, fps: null },
	{ name: 'cheer', frameCount: 2, fps: 8 },
];

describe('animation menu', () => {
	test('opens on the current animation', () => {
		const m = openAnimationMenu(ANIMATIONS, 'walkA');
		expect(m.index).toBe(1);
	});

	test('enter emits a switch action', () => {
		const m = openAnimationMenu(ANIMATIONS, 'idle');
		const r = animationMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'switch', animation: 'idle' });
		expect(r.menu).toBeNull();
	});

	test('c → type → enter emits create', () => {
		let m = openAnimationMenu(ANIMATIONS, 'idle');
		m = open(animationMenuKey(m, ch('c')).menu);
		expect(m.input?.mode).toBe('create');
		m = open(animationMenuKey(m, ch('w')).menu);
		m = open(animationMenuKey(m, ch('a')).menu);
		m = open(animationMenuKey(m, ch('v')).menu);
		m = open(animationMenuKey(m, ch('e')).menu);
		const r = animationMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'create', name: 'wave' });
	});

	test('d emits delete of the highlighted animation', () => {
		const m = openAnimationMenu(ANIMATIONS, 'cheer');
		const r = animationMenuKey(m, ch('d'));
		expect(r.action).toEqual({ type: 'delete', animation: 'cheer' });
	});

	test('reorder uses the frame cursor', () => {
		let m = openAnimationMenu(ANIMATIONS, 'cheer'); // index 2, 2 frames
		m = open(animationMenuKey(m, k('right')).menu); // frameIndex → 1
		const r = animationMenuKey(m, ch('<'));
		expect(r.action).toEqual({
			type: 'reorder',
			animation: 'cheer',
			index: 1,
			delta: -1,
		});
	});

	test('f → digits → enter emits setFps', () => {
		let m = openAnimationMenu(ANIMATIONS, 'walkA');
		m = open(animationMenuKey(m, ch('f')).menu);
		m = open(animationMenuKey(m, ch('1')).menu);
		m = open(animationMenuKey(m, ch('2')).menu);
		const r = animationMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'setFps', animation: 'walkA', fps: 12 });
	});

	test('f → empty → enter clears fps', () => {
		let m = openAnimationMenu(ANIMATIONS, 'idle');
		m = open(animationMenuKey(m, ch('f')).menu);
		const r = animationMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'setFps', animation: 'idle', fps: null });
	});

	test('syncAnimationMenu keeps the selection on a live animation', () => {
		const m = openAnimationMenu(ANIMATIONS, 'cheer'); // index 2
		const next = syncAnimationMenu(m, ANIMATIONS.slice(0, 2)); // cheer removed
		expect(next.index).toBe(1);
	});
});

describe('anchor menu — mouse-native (ADR 0036)', () => {
	const NAMES = ['grip', 'head', 'tail'];
	const REQUIRED = ['grip', 'head'];

	test('enter on a name emits select (scope died with the s toggle)', () => {
		const m = openAnchorMenu(NAMES, 'grip', REQUIRED);
		const r = anchorMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'select', name: 'grip' });
	});

	test('s no longer toggles anything', () => {
		const m = openAnchorMenu(NAMES, 'grip', REQUIRED);
		const r = anchorMenuKey(m, ch('s'));
		expect(r.menu).toEqual(m);
		expect(r.action).toBeUndefined();
	});

	test('clicking a row selects it; clicking + new opens the name input', () => {
		const m = openAnchorMenu(NAMES, 'grip', REQUIRED);
		const r = anchorMenuClick(m, 1, false);
		expect(r.action).toEqual({ type: 'select', name: 'head' });
		const rNew = anchorMenuClick(m, NAMES.length, false);
		expect(rNew.menu?.input).not.toBeNull();
	});

	test('the delete zone deletes a non-required anchor and is inert on required ones', () => {
		const m = openAnchorMenu(NAMES, 'grip', REQUIRED);
		const rDel = anchorMenuClick(m, 2, true); // 'tail'
		expect(rDel.action).toEqual({ type: 'delete', name: 'tail' });
		const rReq = anchorMenuClick(m, 0, true); // 'grip' is required
		expect(rReq.action).toBeUndefined();
	});

	test('the trailing + new row opens a name input (keyboard path)', () => {
		let m = openAnchorMenu(NAMES, 'grip', REQUIRED);
		m = open(anchorMenuKey(m, k('down')).menu); // head
		m = open(anchorMenuKey(m, k('down')).menu); // tail
		m = open(anchorMenuKey(m, k('down')).menu); // + new (index 3)
		expect(m.index).toBe(3);
		m = open(anchorMenuKey(m, k('enter')).menu);
		expect(m.input).not.toBeNull();
		m = open(anchorMenuKey(m, ch('m')).menu);
		m = open(anchorMenuKey(m, ch('u')).menu);
		const r = anchorMenuKey(m, k('enter'));
		expect(r.action).toEqual({ type: 'select', name: 'mu' });
	});
});
