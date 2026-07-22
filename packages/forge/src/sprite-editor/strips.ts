import { frameLabelAt, type SpriteDoc } from '@mmo/render';
import { frameExtent } from './state';

export const FRAME_GAP = 2;
export const STRIP_GAP = 1;

export const DEFAULT_FPS = 5;

export const FPS_MIN = 1;
export const FPS_MAX = 30;

export interface StripFrameBox {
	readonly animation: string;

	readonly name: string;

	readonly index: number;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;

	readonly pxW: number;
	readonly pxH: number;
}

export interface StripLabel {
	readonly animation: string;
	readonly y: number;
	readonly text: string;
}

export interface StripFpsStepper {
	readonly animation: string;

	readonly y: number;
	readonly x: number;
	readonly text: string;
}

export interface StripsLayout {
	readonly zoom: number;
	readonly labels: readonly StripLabel[];
	readonly frames: readonly StripFrameBox[];
	readonly steppers: readonly StripFpsStepper[];

	readonly nameRows: readonly number[];
	readonly contentW: number;
	readonly contentH: number;
}

export function stripsLayout(doc: SpriteDoc, zoom: number): StripsLayout {
	const labels: StripLabel[] = [];
	const frames: StripFrameBox[] = [];
	const nameRows: number[] = [];
	const steppers: StripFpsStepper[] = [];
	let y = 0;
	let contentW = 0;

	for (const animation of doc.animations) {
		const fps = animation.fps;

		const label = animation.name;
		const labelY = y;
		labels.push({ animation: animation.name, y: labelY, text: label });
		contentW = Math.max(contentW, label.length);

		const rowY = y + 1;
		let x = 0;
		let stripH = 1;
		animation.frames.forEach((f, index) => {
			const { w, h } = frameExtent(f);
			const pxW = Math.max(1, w * 2);
			const pxH = Math.max(1, h * 2);
			const box: StripFrameBox = {
				animation: animation.name,
				name: frameLabelAt(animation, index),
				index,
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
		});

		const stripRight = Math.max(0, x - FRAME_GAP);
		contentW = Math.max(contentW, stripRight);
		const nameRow = rowY + stripH;
		nameRows.push(nameRow);

		if (animation.frames.length > 1) {
			const text = `‹ ${fps ?? DEFAULT_FPS}fps ›`;
			const stepperX = Math.max(label.length + 1, stripRight - text.length);
			steppers.push({
				animation: animation.name,
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

export function clampScroll(
	v: number,
	contentLen: number,
	viewLen: number,
): number {
	return Math.max(0, Math.min(v, contentLen - viewLen));
}

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

export interface FocusTab {
	readonly name: string;
	readonly x0: number;
	readonly x1: number;
	readonly active: boolean;
}

export function focusTabs(
	frames: readonly string[],
	active: string,
): { text: string; tabs: FocusTab[] } {
	const tabs: FocusTab[] = [];
	let text = '';
	frames.forEach((name, i) => {
		if (text) text += ' │ ';
		else text = ' ';
		const x0 = text.length;
		text += `frame ${i}`;
		tabs.push({ name, x0, x1: text.length, active: name === active });
	});
	return { text, tabs };
}

export function focusTabAt(
	tabs: readonly FocusTab[],
	x: number,
): FocusTab | undefined {
	return tabs.find((t) => x >= t.x0 && x < t.x1);
}

export function centeredOrigin(contentLen: number, viewLen: number): number {
	return Math.max(0, Math.floor((viewLen - contentLen) / 2));
}
