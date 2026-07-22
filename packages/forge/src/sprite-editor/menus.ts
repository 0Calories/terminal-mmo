export interface MenuKey {
	name: string;
	char?: string;
}

const NAME_RE = /^[A-Za-z0-9:_-]+$/;
const NAME_CHAR_RE = /^[A-Za-z0-9:_-]$/;

export interface AnimationRow {
	name: string;
	frameCount: number;

	fps: number | null;
}

export interface AnimationMenuState {
	animations: readonly AnimationRow[];

	index: number;

	frameIndex: number;

	input: { mode: 'create' | 'fps'; buffer: string } | null;
	error: string;
}

export type AnimationMenuAction =
	| { type: 'switch'; animation: string }
	| { type: 'create'; name: string }
	| { type: 'delete'; animation: string }
	| { type: 'reorder'; animation: string; index: number; delta: number }
	| { type: 'setFps'; animation: string; fps: number | null }
	| { type: 'play'; mode: 'animation' | 'walk'; animation: string }
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
		case 'p':
			return {
				menu: null,
				action: { type: 'play', mode: 'animation', animation: row.name },
			};
		case 'w':
			return {
				menu: null,
				action: { type: 'play', mode: 'walk', animation: row.name },
			};
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

export interface AnchorMenuState {
	names: readonly string[];
	index: number;

	required: readonly string[];

	input: { buffer: string } | null;
	error: string;
}

export type AnchorMenuAction =
	| { type: 'select'; name: string }
	| { type: 'delete'; name: string }
	| { type: 'close' };

export interface AnchorMenuResult {
	menu: AnchorMenuState | null;
	action?: AnchorMenuAction;
}

export function openAnchorMenu(
	names: readonly string[],
	current: string,

	required: readonly string[],
): AnchorMenuState {
	const index = Math.max(0, names.indexOf(current));
	return { names, index, required, input: null, error: '' };
}

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
			if (menu.index >= menu.names.length)
				return { menu: { ...menu, input: { buffer: '' }, error: '' } };
			return {
				menu: null,
				action: { type: 'select', name: menu.names[menu.index] },
			};
		}
	}
	return { menu };
}

export function anchorMenuClick(
	menu: AnchorMenuState,
	row: number,
	deleteZone: boolean,
): AnchorMenuResult {
	if (menu.input) return { menu };
	if (row < 0 || row > menu.names.length) return { menu };
	if (row === menu.names.length)
		return { menu: { ...menu, index: row, input: { buffer: '' }, error: '' } };
	const name = menu.names[row];
	if (deleteZone) {
		if (menu.required.includes(name)) return { menu };
		return { menu: { ...menu, index: row }, action: { type: 'delete', name } };
	}
	return { menu: null, action: { type: 'select', name } };
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
			action: { type: 'select', name: inp.buffer },
		};
	}
	if (k.name === 'char' && k.char && NAME_CHAR_RE.test(k.char))
		return { menu: { ...menu, input: { buffer: inp.buffer + k.char } } };
	return { menu };
}
