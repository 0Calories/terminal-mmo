import { INKS_PER_ROW, RAIL_TOOLS, RAIL_W } from './chrome';
import { FRAME_GAP } from './strips';

export const FLOOR_W = 80;
export const FLOOR_H = 24;

export const CHROME_ROWS = 1;

export const PREVIEW_W = 34;
export const PREVIEW_H = 11;

const TOOLS_ROWS = 1 + Math.ceil(RAIL_TOOLS.length / 2) + 1;
const INK_TITLE_ROWS = 1;

const INK_ACTIVE_ROWS = 1;
const BLANK_ROWS = 1;

const EDIT_BOX_ROWS = 3;

export interface DegradationInput {
	readonly termW: number;
	readonly termH: number;

	readonly zoom: number;

	readonly maxFrameCellW: number;

	readonly frameCount: number;

	readonly inkCount: number;

	readonly variantRowCount: number;

	readonly previewOverride: boolean | null;
}

export interface DegradationLayout {
	readonly placard: string | null;

	readonly previewAutoShow: boolean;

	readonly forceFocus: boolean;

	readonly foldPlayback: boolean;

	readonly focusHint: string;
}

export function previewVisible(
	autoShow: boolean,
	override: boolean | null,
): boolean {
	return override ?? autoShow;
}

export function solveDegradation(input: DegradationInput): DegradationLayout {
	if (input.termW < FLOOR_W || input.termH < FLOOR_H) {
		return {
			placard: `sprite editor needs ≥${FLOOR_W}×${FLOOR_H} — now ${input.termW}×${input.termH}`,
			previewAutoShow: false,
			forceFocus: false,
			foldPlayback: false,
			focusHint: '',
		};
	}

	const canvasW = input.termW - RAIL_W;
	const viewH = input.termH - CHROME_ROWS;

	const paneW = Math.min(PREVIEW_W, canvasW);
	const paneH = Math.min(PREVIEW_H, viewH);
	const coversMoreThanHalf = paneW * 2 > canvasW || paneH * 2 > viewH;
	const previewAutoShow = !coversMoreThanHalf;

	const frameScreenW = input.maxFrameCellW * 2 * input.zoom;
	const twoFramesFit = 2 * frameScreenW + FRAME_GAP <= canvasW;
	const forceFocus = input.frameCount >= 2 && !twoFramesFit;
	const focusHint = forceFocus
		? 'narrow terminal — strips folded to focus (grow width or zoom out)'
		: '';

	const inkRows =
		Math.ceil(input.inkCount / INKS_PER_ROW) +
		INK_ACTIVE_ROWS +
		input.variantRowCount;
	const desiredRail =
		TOOLS_ROWS + INK_TITLE_ROWS + inkRows + BLANK_ROWS + EDIT_BOX_ROWS;
	const foldPlayback = viewH < desiredRail;

	return {
		placard: null,
		previewAutoShow,
		forceFocus,
		foldPlayback,
		focusHint,
	};
}
