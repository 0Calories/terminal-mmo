// Pure state machines for the Sprite editor's modal overlays (ADR 0031, issue
// #339): the animation menu (switch/create/delete/add-frame/reorder/fps) and the
// anchor menu (pick which named anchor to place, at doc or frame scope). Same
// reducer pattern as `colorPicker.ts`: the TUI renders the state and feeds keys in;
// each key returns the next menu (or null to close) plus an optional action the
// TUI applies to the pure editor state. No I/O, no `@opentui/core`.
import type { AnchorScope } from './state';

// A normalized key event — the TUI maps opentui's keypress onto this so the
// reducers stay free of keyboard-library detail.
export interface MenuKey {
	// A logical name: 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' |
	// 'backspace' | 'char'. For 'char', `char` carries the printable character.
	name: string;
	char?: string;
}

const NAME_RE = /^[A-Za-z0-9:_-]+$/;
const NAME_CHAR_RE = /^[A-Za-z0-9:_-]$/;

// ---------------------------------------------------------------------------
// Animation menu
// ---------------------------------------------------------------------------

export interface AnimationRow {
	name: string;
	frameCount: number;
	// The animation's authored fps, or null when it uses the default.
	fps: number | null;
}

export interface AnimationMenuState {
	animations: readonly AnimationRow[];
	// Highlighted animation row.
	index: number;
	// Highlighted frame within that animation (the reorder target).
	frameIndex: number;
	// Non-null while typing a new animation name or an fps value.
	input: { mode: 'create' | 'fps'; buffer: string } | null;
	error: string;
}

export type AnimationMenuAction =
	| { type: 'switch'; animation: string }
	| { type: 'create'; name: string }
	| { type: 'delete'; animation: string }
	| { type: 'addFrame'; animation: string }
	| { type: 'reorder'; animation: string; index: number; delta: number }
	| { type: 'setFps'; animation: string; fps: number | null }
	| { type: 'close' };

export interface AnimationMenuResult {
	menu: AnimationMenuState | null;
	action?: AnimationMenuAction;
}

export function openAnimationMenu(
	animations: readonly AnimationRow[],
	currentAnimation: string,
): AnimationMenuState {
	const index = Math.max(
		0,
		animations.findIndex((p) => p.name === currentAnimation),
	);
	return { animations, index, frameIndex: 0, input: null, error: '' };
}

// Re-sync the menu's animation snapshot after the TUI applies a mutating action,
// clamping the selection onto a still-valid row.
export function syncAnimationMenu(
	menu: AnimationMenuState,
	animations: readonly AnimationRow[],
	keepAnimation?: string,
): AnimationMenuState {
	const wanted = keepAnimation ?? menu.animations[menu.index]?.name;
	const idx = animations.findIndex((p) => p.name === wanted);
	const index = idx >= 0 ? idx : Math.min(menu.index, animations.length - 1);
	const frameCount = animations[index]?.frameCount ?? 1;
	return {
		...menu,
		animations,
		index: Math.max(0, index),
		frameIndex: Math.min(menu.frameIndex, Math.max(0, frameCount - 1)),
		input: null,
		error: '',
	};
}

export function currentAnimationRow(
	menu: AnimationMenuState,
): AnimationRow | undefined {
	return menu.animations[menu.index];
}

export function animationMenuKey(
	menu: AnimationMenuState,
	k: MenuKey,
): AnimationMenuResult {
	if (menu.input) return animationInputKey(menu, k);
	return animationListKey(menu, k);
}

function animationListKey(
	menu: AnimationMenuState,
	k: MenuKey,
): AnimationMenuResult {
	const n = menu.animations.length;
	const row = currentAnimationRow(menu);
	switch (k.name) {
		case 'escape':
			return { menu: null, action: { type: 'close' } };
		case 'up':
			return {
				menu: {
					...menu,
					index: (menu.index - 1 + n) % n,
					frameIndex: 0,
					error: '',
				},
			};
		case 'down':
			return {
				menu: {
					...menu,
					index: (menu.index + 1) % n,
					frameIndex: 0,
					error: '',
				},
			};
		case 'left':
			return {
				menu: { ...menu, frameIndex: Math.max(0, menu.frameIndex - 1) },
			};
		case 'right': {
			const max = Math.max(0, (row?.frameCount ?? 1) - 1);
			return {
				menu: { ...menu, frameIndex: Math.min(max, menu.frameIndex + 1) },
			};
		}
		case 'enter':
			if (!row) return { menu, action: { type: 'close' } };
			return { menu: null, action: { type: 'switch', animation: row.name } };
	}
	if (k.name !== 'char' || !row) return { menu };
	switch (k.char) {
		case 'c':
			return {
				menu: { ...menu, input: { mode: 'create', buffer: '' }, error: '' },
			};
		case 'd':
			return { menu, action: { type: 'delete', animation: row.name } };
		case 'a':
			return { menu, action: { type: 'addFrame', animation: row.name } };
		case 'f':
			return {
				menu: {
					...menu,
					input: {
						mode: 'fps',
						buffer: row.fps === null ? '' : String(row.fps),
					},
					error: '',
				},
			};
		case '[':
		case '<':
			return {
				menu,
				action: {
					type: 'reorder',
					animation: row.name,
					index: menu.frameIndex,
					delta: -1,
				},
			};
		case ']':
		case '>':
			return {
				menu,
				action: {
					type: 'reorder',
					animation: row.name,
					index: menu.frameIndex,
					delta: 1,
				},
			};
	}
	return { menu };
}

function animationInputKey(
	menu: AnimationMenuState,
	k: MenuKey,
): AnimationMenuResult {
	const inp = menu.input;
	if (!inp) return { menu };
	if (k.name === 'escape') return { menu: { ...menu, input: null, error: '' } };
	if (k.name === 'backspace')
		return {
			menu: { ...menu, input: { ...inp, buffer: inp.buffer.slice(0, -1) } },
		};
	if (k.name === 'enter') return animationInputCommit(menu, inp);
	if (k.name === 'char' && k.char) {
		if (inp.mode === 'fps') {
			if (!/[0-9]/.test(k.char) || inp.buffer.length >= 3) return { menu };
		} else if (!NAME_CHAR_RE.test(k.char)) {
			return { menu };
		}
		return {
			menu: { ...menu, input: { ...inp, buffer: inp.buffer + k.char } },
		};
	}
	return { menu };
}

function animationInputCommit(
	menu: AnimationMenuState,
	inp: { mode: 'create' | 'fps'; buffer: string },
): AnimationMenuResult {
	if (inp.mode === 'create') {
		if (!NAME_RE.test(inp.buffer))
			return { menu: { ...menu, error: 'enter a legal animation name' } };
		return { menu, action: { type: 'create', name: inp.buffer } };
	}
	// fps: empty clears back to the default; otherwise a positive integer.
	if (inp.buffer === '')
		return {
			menu,
			action: {
				type: 'setFps',
				animation: menu.animations[menu.index].name,
				fps: null,
			},
		};
	const fps = Number.parseInt(inp.buffer, 10);
	if (!Number.isFinite(fps) || fps <= 0)
		return { menu: { ...menu, error: 'fps must be a positive number' } };
	return {
		menu,
		action: {
			type: 'setFps',
			animation: menu.animations[menu.index].name,
			fps,
		},
	};
}

// ---------------------------------------------------------------------------
// Anchor menu
// ---------------------------------------------------------------------------

export interface AnchorMenuState {
	// Candidate anchor names (required-for-role first, then existing), plus the
	// implicit "+ new" row appended by the reducer's option list.
	names: readonly string[];
	index: number;
	scope: AnchorScope;
	// Non-null while typing a new anchor name.
	input: { buffer: string } | null;
	error: string;
}

export type AnchorMenuAction =
	| { type: 'select'; name: string; scope: AnchorScope }
	| { type: 'close' };

export interface AnchorMenuResult {
	menu: AnchorMenuState | null;
	action?: AnchorMenuAction;
}

export function openAnchorMenu(
	names: readonly string[],
	current: string,
	scope: AnchorScope,
): AnchorMenuState {
	const index = Math.max(0, names.indexOf(current));
	return { names, index, scope, input: null, error: '' };
}

// The rows shown: every candidate name plus a trailing "+ new" entry.
export function anchorRowCount(menu: AnchorMenuState): number {
	return menu.names.length + 1;
}

export function anchorMenuKey(
	menu: AnchorMenuState,
	k: MenuKey,
): AnchorMenuResult {
	if (menu.input) return anchorInputKey(menu, k);
	const rows = anchorRowCount(menu);
	switch (k.name) {
		case 'escape':
			return { menu: null, action: { type: 'close' } };
		case 'up':
			return {
				menu: { ...menu, index: (menu.index - 1 + rows) % rows, error: '' },
			};
		case 'down':
			return { menu: { ...menu, index: (menu.index + 1) % rows, error: '' } };
		case 'enter': {
			// The last row is "+ new".
			if (menu.index >= menu.names.length)
				return { menu: { ...menu, input: { buffer: '' }, error: '' } };
			return {
				menu: null,
				action: {
					type: 'select',
					name: menu.names[menu.index],
					scope: menu.scope,
				},
			};
		}
	}
	if (k.name === 'char' && k.char === 's')
		return {
			menu: { ...menu, scope: menu.scope === 'doc' ? 'frame' : 'doc' },
		};
	return { menu };
}

function anchorInputKey(menu: AnchorMenuState, k: MenuKey): AnchorMenuResult {
	const inp = menu.input;
	if (!inp) return { menu };
	if (k.name === 'escape') return { menu: { ...menu, input: null, error: '' } };
	if (k.name === 'backspace')
		return { menu: { ...menu, input: { buffer: inp.buffer.slice(0, -1) } } };
	if (k.name === 'enter') {
		if (!NAME_RE.test(inp.buffer))
			return { menu: { ...menu, error: 'enter a legal anchor name' } };
		return {
			menu: null,
			action: { type: 'select', name: inp.buffer, scope: menu.scope },
		};
	}
	if (k.name === 'char' && k.char && NAME_CHAR_RE.test(k.char))
		return { menu: { ...menu, input: { buffer: inp.buffer + k.char } } };
	return { menu };
}
