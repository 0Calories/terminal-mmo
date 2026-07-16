// The normalized input seam (spec #387, locked #376) — the single entry point
// through which BOTH devices reach the pure editor layer. Keyboard and mouse
// each normalize into one device-neutral `EditorInput` (a Pixel position, a
// button role, a modifier set, a wheel delta); `applyInput` is the one reducer
// that drives the pure layer from it. Keyboard/mouse parity is therefore
// structural, not two parallel code paths: a mouse left-click and a keyboard
// paint at the same Pixel produce the same `EditorInput` and the same next
// state, testable by construction.
//
// Scope note (#390, #397): the tools that consume pointer input today are the
// pencil (with the eraser as its transparent-ink spelling) and the momentary
// alt-click eyedrop (spec #387), so `applyInput` routes paint or a key sample.
// Later slices add the anchor-tool suite (fill/line/rect/ellipse/select/move/
// paste), wheel routing (scroll/zoom), and middle-drag pan on top of this same
// event — the seam is shaped for them now.
import {
	eyedropAt,
	moveCursor,
	paintWithInk,
	type SpriteEditorState,
	TRANSPARENT_INK,
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

// One device-neutral input event. `pixel` is always in Pixel coordinates (the
// mouse normalizer's caller resolves screen→Pixel through the canvas geometry;
// the keyboard's Pixel is the cursor). `wheel` is a signed row delta, 0 for a
// non-wheel event.
export interface EditorInput {
	readonly pixel: { readonly x: number; readonly y: number };
	readonly button: InputButton;
	readonly mods: InputMods;
	readonly wheel: number;
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
}

const MOUSE_BUTTON: Record<RawMouse['button'], InputButton> = {
	left: 'primary',
	right: 'secondary',
	middle: 'middle',
	none: 'none',
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

// Drive the pure layer from a normalized event. Always moves the cursor to the
// event's Pixel (both devices agree on this); then, for the paint tools, applies
// the effective ink. The active tool is the pencil (`paint`) or its transparent
// spelling (`erase`); other tools take pointer input in later slices.
export function applyInput(
	state: SpriteEditorState,
	input: EditorInput,
): SpriteEditorState {
	const { x, y } = input.pixel;
	const moved = moveCursor(state, x, y);
	if (input.button === 'none' || input.button === 'middle') return moved;
	// Momentary eyedrop (spec #387): alt + any paint button samples the colour
	// key under the Pixel instead of painting, whatever tool is in hand. The
	// keyboard `i` key is the one-shot spelling; both reach `eyedropAt`.
	if (input.mods.alt) return eyedropAt(moved, x, y);
	if (moved.tool !== 'paint' && moved.tool !== 'erase') return moved;

	// `secondary` forces transparent ink; the eraser tool is transparent whatever
	// the ink; otherwise the active ink wins.
	const ink =
		input.button === 'secondary' || moved.tool === 'erase'
			? TRANSPARENT_INK
			: moved.ink;
	return paintWithInk(moved, x, y, ink);
}
