// Pure layout for the two canvas views (spec #387, locked #375): STRIPS — the
// default, every Animation a labeled horizontal strip of its Frames, all editable in
// place — and FOCUS (`tab`) — one Frame centred under a Frame-name tab row.
// Everything is in "content" coordinates: the unscrolled screen-cell grid the
// strips would occupy; `tui.ts` subtracts a scroll offset and clips. Hit-tests
// invert the same geometry, so click-through Frame activation and the keyboard
// cursor agree on where every Frame sits by construction.
import type { SpriteDoc } from '@mmo/render';
import { frameExtent } from './state';

// Columns between frame blocks in a strip; blank rows between strips.
export const FRAME_GAP = 2;
export const STRIP_GAP = 1;

// The default per-animation playback rate (EMOTE_FPS in @mmo/core): what an
// animation with no authored fps entry plays at, and what the stepper shows.
export const DEFAULT_FPS = 5;
// The author-editable fps range the stepper clamps to (QA round 3).
export const FPS_MIN = 1;
export const FPS_MAX = 30;

// One Frame's block: its screen-cell rect in content coordinates. A frame of
// w×h cells is 2w×2h Pixels, each Pixel zoom×zoom cells on screen.
export interface StripFrameBox {
	readonly animation: string;
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	// Pixel extent, for cursor clamping.
	readonly pxW: number;
	readonly pxH: number;
}

export interface StripLabel {
	readonly animation: string;
	readonly y: number;
	readonly text: string;
}

// A multi-frame strip's fps stepper on its label row: `‹ 5fps ›` with the
// chevrons as click targets stepping the animation's fps by ±1 (clamped 1–30 by
// the caller). It is right-justified so its right edge meets the strip's right
// edge; on a strip too narrow for name + stepper it clamps one space past the
// name (overhanging the edge). Single-frame strips carry none.
export interface StripFpsStepper {
	readonly animation: string;
	// Content row (the strip's label row) and the stepper text's extent.
	readonly y: number;
	readonly x: number;
	readonly text: string;
}

export interface StripsLayout {
	readonly zoom: number;
	readonly labels: readonly StripLabel[];
	readonly frames: readonly StripFrameBox[];
	readonly steppers: readonly StripFpsStepper[];
	// Row carrying each strip's frame names (the active frame is underlined
	// there); one per strip, aligned with `labels` by index.
	readonly nameRows: readonly number[];
	readonly contentW: number;
	readonly contentH: number;
}

// Every animation in doc order, then any frame no animation references as its own
// implicit single-frame strip (the parser's implicit-animation rule).
function stripSpecs(doc: SpriteDoc): { animation: string; frames: string[] }[] {
	const specs = Object.entries(doc.animations).map(([animation, frames]) => ({
		animation,
		frames: [...frames],
	}));
	const referenced = new Set(specs.flatMap((s) => s.frames));
	for (const f of doc.frames)
		if (!referenced.has(f.name))
			specs.push({ animation: f.name, frames: [f.name] });
	return specs;
}

export function stripsLayout(doc: SpriteDoc, zoom: number): StripsLayout {
	const labels: StripLabel[] = [];
	const frames: StripFrameBox[] = [];
	const nameRows: number[] = [];
	const steppers: StripFpsStepper[] = [];
	let y = 0;
	let contentW = 0;

	for (const spec of stripSpecs(doc)) {
		const fps = doc.fps[spec.animation];
		// The label is just the animation name (the frame count and the static fps
		// text moved out — the count is self-evident from the strip, the fps now
		// lives on the interactive stepper).
		const label = spec.animation;
		const labelY = y;
		labels.push({ animation: spec.animation, y: labelY, text: label });
		contentW = Math.max(contentW, label.length);

		const rowY = y + 1;
		let x = 0;
		let stripH = 1;
		for (const name of spec.frames) {
			const f = doc.frames.find((fr) => fr.name === name);
			if (!f) continue;
			const { w, h } = frameExtent(f);
			const pxW = Math.max(1, w * 2);
			const pxH = Math.max(1, h * 2);
			const box: StripFrameBox = {
				animation: spec.animation,
				name,
				x,
				y: rowY,
				w: pxW * zoom,
				h: pxH * zoom,
				pxW,
				pxH,
			};
			frames.push(box);
			stripH = Math.max(stripH, box.h);
			x += box.w + FRAME_GAP;
		}
		// The strip's right edge: the last frame box's right edge (drop the trailing
		// inter-frame gap the loop added).
		const stripRight = Math.max(0, x - FRAME_GAP);
		contentW = Math.max(contentW, stripRight);
		const nameRow = rowY + stripH;
		nameRows.push(nameRow);
		// The fps stepper rides the LABEL row, right-justified so its right edge
		// meets the strip's right edge. On a strip too narrow for name + stepper it
		// clamps to one space past the name (overhanging the edge) — never colliding.
		if (spec.frames.length > 1) {
			const text = `‹ ${fps ?? DEFAULT_FPS}fps ›`;
			const stepperX = Math.max(label.length + 1, stripRight - text.length);
			steppers.push({
				animation: spec.animation,
				y: labelY,
				x: stepperX,
				text,
			});
			contentW = Math.max(contentW, stepperX + text.length);
		}
		y = nameRow + 1 + STRIP_GAP;
	}

	return {
		zoom,
		labels,
		frames,
		nameRows,
		steppers,
		contentW,
		contentH: Math.max(0, y - STRIP_GAP),
	};
}

// The fps step a click at content cell (cx, cy) means: the `‹` chevron (and the
// cell after it) steps down, the `›` (and the cell before it) steps up; the
// number between is dead space. Null anywhere else.
export function stepperHit(
	layout: StripsLayout,
	cx: number,
	cy: number,
): { animation: string; delta: -1 | 1 } | null {
	for (const st of layout.steppers) {
		if (cy !== st.y || cx < st.x || cx >= st.x + st.text.length) continue;
		const rel = cx - st.x;
		if (rel <= 1) return { animation: st.animation, delta: -1 };
		if (rel >= st.text.length - 2) return { animation: st.animation, delta: 1 };
		return null;
	}
	return null;
}

export function frameBoxOf(
	layout: StripsLayout,
	name: string,
): StripFrameBox | undefined {
	return layout.frames.find((f) => f.name === name);
}

// The Frame (and the Pixel inside it) a content cell hits, or null on dead
// space. Drives click-through activation: the click both activates the Frame
// and lands as a paint at the returned Pixel.
export function stripsHit(
	layout: StripsLayout,
	cx: number,
	cy: number,
): { frame: StripFrameBox; px: number; py: number } | null {
	for (const f of layout.frames) {
		if (cx < f.x || cx >= f.x + f.w || cy < f.y || cy >= f.y + f.h) continue;
		return {
			frame: f,
			px: Math.floor((cx - f.x) / layout.zoom),
			py: Math.floor((cy - f.y) / layout.zoom),
		};
	}
	return null;
}

// ---------------------------------------------------------------------------
// Scrolling — shared by wheel, middle-drag pan, and cursor-follow
// ---------------------------------------------------------------------------

export function clampScroll(
	v: number,
	contentLen: number,
	viewLen: number,
): number {
	return Math.max(0, Math.min(v, contentLen - viewLen));
}

// The smallest scroll adjustment that brings the content interval [lo, hi)
// fully into a viewport of `viewLen` (the interval's start wins when it is
// larger than the viewport).
export function scrollIntoView(
	scroll: number,
	lo: number,
	hi: number,
	viewLen: number,
): number {
	let next = scroll;
	if (hi > next + viewLen) next = hi - viewLen;
	if (lo < next) next = lo;
	return Math.max(0, next);
}

// ---------------------------------------------------------------------------
// Focus mode — one Frame centred, its animation's frame names as a tab row
// ---------------------------------------------------------------------------

export interface FocusTab {
	readonly name: string;
	readonly x0: number;
	readonly x1: number;
	readonly active: boolean;
}

// The tab row: ` idle │ walk │ jump ` with each name's rendered extent as a
// click target.
export function focusTabs(
	frames: readonly string[],
	active: string,
): { text: string; tabs: FocusTab[] } {
	const tabs: FocusTab[] = [];
	let text = '';
	for (const name of frames) {
		if (text) text += ' │ ';
		else text = ' ';
		const x0 = text.length;
		text += name;
		tabs.push({ name, x0, x1: text.length, active: name === active });
	}
	return { text, tabs };
}

export function focusTabAt(
	tabs: readonly FocusTab[],
	x: number,
): FocusTab | undefined {
	return tabs.find((t) => x >= t.x0 && x < t.x1);
}

// The offset that centres content of `contentLen` in a `viewLen` viewport; 0
// when it does not fit (the camera scrolls instead).
export function centeredOrigin(contentLen: number, viewLen: number): number {
	return Math.max(0, Math.floor((viewLen - contentLen) / 2));
}
