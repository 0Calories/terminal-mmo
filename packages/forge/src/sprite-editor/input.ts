import {
	type AnchorTool,
	beginFloat,
	beginShape,
	cancelFloat,
	cancelShape,
	commitFloat,
	commitSelection,
	commitShape,
	eyedropAt,
	floodFill,
	isShapeTool,
	moveCursor,
	moveFloatTo,
	paintWithInk,
	pencilLineTo,
	type SpriteEditorState,
	selectionContains,
	TRANSPARENT_INK,
	updateShape,
} from './state';

export type InputButton = 'primary' | 'secondary' | 'middle' | 'none';

export interface InputMods {
	readonly shift: boolean;
	readonly alt: boolean;
	readonly ctrl: boolean;
}

export type InputPhase = 'start' | 'move' | 'commit' | 'toggle' | 'cancel';

export interface EditorInput {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly button: InputButton;
	readonly mods: InputMods;
	readonly wheel: number;

	readonly phase?: InputPhase;
}

export interface RawMouse {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly button: 'left' | 'right' | 'middle' | 'none';
	readonly shift?: boolean;
	readonly alt?: boolean;
	readonly ctrl?: boolean;

	readonly scroll?: number;

	readonly phase?: 'down' | 'drag' | 'up';
}

const MOUSE_BUTTON: Record<RawMouse['button'], InputButton> = {
	left: 'primary',
	right: 'secondary',
	middle: 'middle',
	none: 'none',
};

const MOUSE_PHASE: Record<'down' | 'drag' | 'up', InputPhase> = {
	down: 'start',
	drag: 'move',
	up: 'commit',
};

export function normalizeMouse(raw: RawMouse): EditorInput {
	return {
		pixel: { x: raw.pixel.x, y: raw.pixel.y },
		button: MOUSE_BUTTON[raw.button],
		mods: {
			shift: raw.shift ?? false,
			alt: raw.alt ?? false,
			ctrl: raw.ctrl ?? false,
		},
		wheel: raw.scroll ?? 0,
		...(raw.phase ? { phase: MOUSE_PHASE[raw.phase] } : {}),
	};
}

export type KeyPaint = 'ink' | 'transparent' | 'none';

export interface RawKey {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly paint: KeyPaint;
	readonly shift?: boolean;
	readonly alt?: boolean;
	readonly ctrl?: boolean;

	readonly phase?: InputPhase;
}

const KEY_BUTTON: Record<KeyPaint, InputButton> = {
	ink: 'primary',
	transparent: 'secondary',
	none: 'none',
};

export function normalizeKey(raw: RawKey): EditorInput {
	return {
		pixel: { x: raw.pixel.x, y: raw.pixel.y },
		button: KEY_BUTTON[raw.paint],
		mods: {
			shift: raw.shift ?? false,
			alt: raw.alt ?? false,
			ctrl: raw.ctrl ?? false,
		},
		wheel: 0,
		...(raw.phase ? { phase: raw.phase } : {}),
	};
}

export type WheelDirection = 'up' | 'down' | 'left' | 'right';

export type WheelRoute =
	| { readonly kind: 'scroll'; readonly dx: number; readonly dy: number }
	| { readonly kind: 'zoom'; readonly dir: 1 | -1 };

export const WHEEL_STEP = 3;

export function routeWheel(
	direction: WheelDirection,
	mods: InputMods,
	step: number = WHEEL_STEP,
): WheelRoute {
	const horizontal = direction === 'left' || direction === 'right';

	if (mods.ctrl && !horizontal)
		return { kind: 'zoom', dir: direction === 'up' ? 1 : -1 };
	const back = direction === 'up' || direction === 'left';
	const delta = back ? -step : step;

	if (mods.shift || horizontal) return { kind: 'scroll', dx: delta, dy: 0 };
	return { kind: 'scroll', dx: 0, dy: delta };
}

export function applyInput(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	if (input.mods.alt && input.button !== 'none' && input.button !== 'middle') {
		const moved = moveCursor(state, input.pixel.x, input.pixel.y);
		return eyedropAt(moved, input.pixel.x, input.pixel.y);
	}

	if (state.tool === 'select') return applyAnchorGesture(state, input);
	if (isShapeTool(state.tool)) return applyAnchorGesture(state, input);
	if (state.tool === 'move') return applyMoveInput(state, input);

	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	if (input.button === 'none' || input.button === 'middle') return moved;

	const ink =
		input.button === 'secondary' || moved.tool === 'erase'
			? TRANSPARENT_INK
			: moved.ink;

	if (moved.tool === 'fill') return floodFill(moved, x, y, ink);
	if (moved.tool !== 'paint' && moved.tool !== 'erase') return moved;

	if (input.mods.shift && moved.lastPaint)
		return pencilLineTo(moved, x, y, ink);
	const painted = paintWithInk(moved, x, y, ink);
	return { ...painted, lastPaint: { x, y } };
}

function applyAnchorGesture(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	const tool = moved.tool as AnchorTool;
	const constrain = input.mods.shift;

	const ink =
		tool === 'select' || input.button === 'secondary'
			? TRANSPARENT_INK
			: moved.ink;
	const finish =
		tool === 'select'
			? (s: SpriteEditorState) =>
					commitSelection(updateShape(s, x, y, constrain))
			: (s: SpriteEditorState) => commitShape(updateShape(s, x, y, constrain));

	const phase: InputPhase =
		input.phase ?? (input.button === 'none' ? 'move' : 'toggle');

	switch (phase) {
		case 'start':
			return beginShape(moved, tool, x, y, ink, constrain);
		case 'move':
			return updateShape(moved, x, y, constrain);
		case 'commit':
			return moved.shape ? finish(moved) : moved;
		case 'toggle':
			return moved.shape
				? finish(moved)
				: beginShape(moved, tool, x, y, ink, constrain);
		case 'cancel':
			return cancelShape(moved);
	}
}

function applyMoveInput(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	const phase: InputPhase =
		input.phase ?? (input.button === 'none' ? 'move' : 'toggle');
	const grabbable =
		moved.selection !== null && selectionContains(moved.selection, x, y);

	switch (phase) {
		case 'start':
			return moved.float || !grabbable ? moved : beginFloat(moved, { x, y });
		case 'move':
			return moved.float ? moveFloatTo(moved, x, y) : moved;
		case 'commit':
			return moved.float ? commitFloat(moveFloatTo(moved, x, y)) : moved;
		case 'toggle':
			if (moved.float) return commitFloat(moved);
			return grabbable ? beginFloat(moved, { x, y }) : moved;
		case 'cancel':
			return moved.float ? cancelFloat(moved) : moved;
	}
}

export const DOUBLE_CLICK_MS = 400;

export function createDoubleClickDetector(
	now: () => number,
	thresholdMs: number = DOUBLE_CLICK_MS,
): (x: number, y: number) => boolean {
	let last: { x: number; y: number; t: number } | null = null;
	return (x, y) => {
		const t = now();
		const double =
			last !== null &&
			last.x === x &&
			last.y === y &&
			t - last.t <= thresholdMs;
		last = double ? null : { x, y, t };
		return double;
	};
}
