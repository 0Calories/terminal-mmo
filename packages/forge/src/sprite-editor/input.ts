// The normalized input seam (spec #387, locked #376) — the single entry point
// through which BOTH devices reach the pure editor layer. Keyboard and mouse
// each normalize into one device-neutral `EditorInput` (a Pixel position, a
// button role, a modifier set, a wheel delta); `applyInput` is the one reducer
// that drives the pure layer from it. Keyboard/mouse parity is therefore
// structural, not two parallel code paths: a mouse left-click and a keyboard
// paint at the same Pixel produce the same `EditorInput` and the same next
// state, testable by construction.
//
// Scope note (#394): the pencil (with the eraser as its transparent-ink
// spelling) and the geometry tools (line/rect/ellipse) consume pointer input
// through this seam. The geometry tools drive ONE shared pending-shape anchor
// state (spec #387): a mouse drag-commits (down→start, drag→move, up→commit) and
// a keyboard click-clicks (enter→toggle, arrows→move, esc→cancel) over the same
// state and the same reducer, so device parity is structural. Later slices add
// select/move/paste, which share this same anchor grammar.
import {
	beginShape,
	cancelShape,
	commitShape,
	isShapeTool,
	moveCursor,
	paintWithInk,
	pencilLineTo,
	type ShapeTool,
	type SpriteEditorState,
	TRANSPARENT_INK,
	updateShape,
} from './state';

// The button role a normalized event carries. `primary` applies the active tool
// with the active ink; `secondary` applies it with transparent ink (the right
// button / eraser); `middle` is reserved for pan; `none` is a bare move/hover.
export type InputButton = 'primary' | 'secondary' | 'middle' | 'none';

export interface InputMods {
	readonly shift: boolean;
	readonly alt: boolean;
	readonly ctrl: boolean;
}

// The gesture phase an anchor-tool event carries (spec #387). Mouse gestures map
// down→start, drag→move, up→commit; keyboard maps enter→toggle (place anchor,
// then commit), arrows→move, esc→cancel. The paint tools ignore it.
export type InputPhase = 'start' | 'move' | 'commit' | 'toggle' | 'cancel';

// One device-neutral input event. `pixel` is always in Pixel coordinates (the
// mouse normalizer's caller resolves screen→Pixel through the canvas geometry;
// the keyboard's Pixel is the cursor). `wheel` is a signed row delta, 0 for a
// non-wheel event.
export interface EditorInput {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly button: InputButton;
	readonly mods: InputMods;
	readonly wheel: number;
	// The anchor-tool gesture phase, when the event is part of a shape gesture;
	// omitted for a plain paint/hover event.
	readonly phase?: InputPhase;
}

// ---------------------------------------------------------------------------
// Normalizers — device encodings → the one canonical event
// ---------------------------------------------------------------------------

// A raw terminal mouse event, already resolved to Pixel space by the caller's
// canvas geometry. Button names follow the terminal's left/right/middle report.
export interface RawMouse {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly button: 'left' | 'right' | 'middle' | 'none';
	readonly shift?: boolean;
	readonly alt?: boolean;
	readonly ctrl?: boolean;
	// Signed wheel delta (negative up, positive down); omit / 0 when not a wheel.
	readonly scroll?: number;
	// The pointer gesture stage, for anchor tools: press → move → release.
	readonly phase?: 'down' | 'drag' | 'up';
}

const MOUSE_BUTTON: Record<RawMouse['button'], InputButton> = {
	left: 'primary',
	right: 'secondary',
	middle: 'middle',
	none: 'none',
};

// A mouse gesture stage maps onto the device-neutral anchor phase.
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

// The keyboard has no pointer, so its Pixel is the editor cursor and its
// "button" is chosen by which paint intent the key expressed: `ink` = paint the
// active ink (like a left click), `transparent` = paint transparent (like a
// right click / the eraser), `none` = a bare cursor move.
export type KeyPaint = 'ink' | 'transparent' | 'none';

export interface RawKey {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly paint: KeyPaint;
	readonly shift?: boolean;
	readonly alt?: boolean;
	readonly ctrl?: boolean;
	// The anchor-tool gesture the key expressed: enter → toggle (place / commit),
	// a cursor step → move, esc → cancel. Omitted for a plain paint/move key.
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

// ---------------------------------------------------------------------------
// Wheel routing (spec #387, locked #376): wheel scrolls, shift-wheel scrolls
// horizontally, ctrl-wheel zooms. The route is pure grammar — what the scroll
// or zoom *targets* (the strip stack, the focus camera, the zoom ladder) is the
// caller's presentation state, so the deltas come back device-neutral.
// ---------------------------------------------------------------------------

export type WheelDirection = 'up' | 'down' | 'left' | 'right';

export type WheelRoute =
	| { readonly kind: 'scroll'; readonly dx: number; readonly dy: number }
	| { readonly kind: 'zoom'; readonly dir: 1 | -1 };

// Rows/columns one wheel notch scrolls (matches the zone editor's feel).
export const WHEEL_STEP = 3;

export function routeWheel(
	direction: WheelDirection,
	mods: InputMods,
	step: number = WHEEL_STEP,
): WheelRoute {
	const horizontal = direction === 'left' || direction === 'right';
	// Only a vertical ctrl-wheel zooms — a sideways notch has no in/out meaning.
	if (mods.ctrl && !horizontal)
		return { kind: 'zoom', dir: direction === 'up' ? 1 : -1 };
	const back = direction === 'up' || direction === 'left';
	const delta = back ? -step : step;
	// Shift promotes a vertical wheel to the horizontal axis; a native
	// horizontal wheel is already there.
	if (mods.shift || horizontal) return { kind: 'scroll', dx: delta, dy: 0 };
	return { kind: 'scroll', dx: 0, dy: delta };
}

// ---------------------------------------------------------------------------
// The one reducer
// ---------------------------------------------------------------------------

// Drive the pure layer from a normalized event. The geometry tools run the
// shared pending-shape lifecycle; the pencil (`paint`) and its transparent
// spelling (`erase`) paint the effective ink, with shift chaining a line from
// the last painted Pixel (spec #387). Every event first moves the cursor — both
// devices agree the cursor follows the event's Pixel.
export function applyInput(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	if (isShapeTool(state.tool)) return applyShapeInput(state, input);

	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	if (input.button === 'none' || input.button === 'middle') return moved;
	if (moved.tool !== 'paint' && moved.tool !== 'erase') return moved;

	// `secondary` forces transparent ink; the eraser tool is transparent whatever
	// the ink; otherwise the active ink wins.
	const ink =
		input.button === 'secondary' || moved.tool === 'erase'
			? TRANSPARENT_INK
			: moved.ink;
	// Shift + a prior point chains a straight line from it (spec #387); a plain
	// paint just lights the Pixel. Either way the Pixel becomes the last point.
	if (input.mods.shift && moved.lastPaint)
		return pencilLineTo(moved, x, y, ink);
	const painted = paintWithInk(moved, x, y, ink);
	return { ...painted, lastPaint: { x, y } };
}

// Drive the shared pending-shape lifecycle from a normalized event. Both devices
// feed this one reducer: the phase (mouse press/move/release, keyboard toggle/
// move/cancel) selects the transition, so drag-commit and click-click are the
// same code path over the same state (spec #387).
function applyShapeInput(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	const tool = moved.tool as ShapeTool;
	const constrain = input.mods.shift;
	const ink = input.button === 'secondary' ? TRANSPARENT_INK : moved.ink;
	// A phase-less event defaults by button: a bare move updates, a press toggles
	// (the keyboard's enter grammar), so callers may omit the phase.
	const phase: InputPhase =
		input.phase ?? (input.button === 'none' ? 'move' : 'toggle');

	switch (phase) {
		case 'start':
			return beginShape(moved, tool, x, y, ink, constrain);
		case 'move':
			return updateShape(moved, x, y, constrain);
		case 'commit':
			return moved.shape
				? commitShape(updateShape(moved, x, y, constrain))
				: moved;
		case 'toggle':
			return moved.shape
				? commitShape(updateShape(moved, x, y, constrain))
				: beginShape(moved, tool, x, y, ink, constrain);
		case 'cancel':
			return cancelShape(moved);
	}
}
