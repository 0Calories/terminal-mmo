// The small-terminal degradation solver (spec #387, locked in the #383 session).
// A single pure function maps (terminal size, zoom, Frame sizes, ink count, the
// user's manual preview override) → either a "too small" placard or a set of
// reversible layout decisions. `tui.ts` only OBEYS the result: it draws the
// placard, or hides/shows the preview, forces the focus view, folds the `edit`
// box — never deciding any of that itself. Keeping the ladder here makes every
// rung's trigger and its reversal unit-testable without a screen.
//
// The ladder, above the hard 80×24 floor (all rungs reversible — growing the
// terminal back restores the previous state):
//   1. the preview auto-hides when its float would cover more than half the
//      canvas interior (the manual `v` toggle overrides in both directions);
//   2. the strips view is forced to focus mode when fewer than two full Frames
//      fit side by side at the current zoom (with a status hint);
//   3. the `edit` box folds to a single hint row when the rail can't fit the
//      full ink list and the box together;
//   4. the rail never hides (there is no rung that removes it).
import { INKS_PER_ROW, RAIL_TOOLS, RAIL_W } from './chrome';
import { FRAME_GAP } from './strips';

// The hard floor: below EITHER dimension the editor shows a placard instead of
// its UI (it never exits, never loses data, recovers instantly on resize).
export const FLOOR_W = 80;
export const FLOOR_H = 24;

// The one chrome row (the status readout) under the canvas region — mirrors
// `tui.ts`'s CHROME_H. The old persistent hint line died with the keymap cull
// (QA round 3); the canvas gained its row.
export const CHROME_ROWS = 1;

// The floating Composited preview pane's native size (#393): ~34×11 including
// its border + control row. Docked top-right, it floats over the canvas.
export const PREVIEW_W = 34;
export const PREVIEW_H = 11;

// The rail's fixed vertical composition, mirroring `chrome.ts`'s railModel:
// a tools box (title + two-per-row tool rows + a blank), then the ink box
// (title + the windowed ink list), then the `edit` box. These constants let
// the solver reason about "can the full ink list and the edit box both
// fit?" without rendering.
const TOOLS_ROWS = 1 + Math.ceil(RAIL_TOOLS.length / 2) + 1;
const INK_TITLE_ROWS = 1;
// The active-colour readout row under the swatch grid.
const INK_ACTIVE_ROWS = 1;
const BLANK_ROWS = 1;
// The full `edit` box height (matches railBoxes() in chrome.ts, round 3): one
// labeled box below the ink grid — title + `▤ animation · ◎ anchor` + `⤢ canvas ·
// ◫ preview` = 3 rows. When the rung folds it, it collapses to a single row.
// Mouse-primary (ADR 0035) leans on these buttons, so the accounting must be
// honest: at the ≥80×24 floor the full box fits.
const EDIT_BOX_ROWS = 3;

export interface DegradationInput {
	// The terminal's size in cells.
	readonly termW: number;
	readonly termH: number;
	// The fatbits zoom (×z) the canvas is drawn at.
	readonly zoom: number;
	// The widest Frame's width in CELLS (the rung-2 two-Frames-fit test scales it
	// by the 1:2 Pixel aspect and the zoom).
	readonly maxFrameCellW: number;
	// How many Frames the doc has. With fewer than two there is no second Frame to
	// lose, so rung 2 never forces focus (strips and focus are equivalent then).
	readonly frameCount: number;
	// The inks the rail would list (locals + palette + dynamics + transparent).
	// Rung 3's fold is content-aware on this: a long palette is what makes the
	// full ink swatch grid (8 per row) and the edit box unable to share the
	// rail.
	readonly inkCount: number;
	// Session p/a variant rows currently shown in the ink box (0–2).
	readonly variantRowCount: number;
	// The user's manual preview override (the `v` key): null follows the auto
	// rung; true forces the pane visible; false forces it hidden.
	readonly previewOverride: boolean | null;
}

export interface DegradationLayout {
	// Non-null below the floor: the centred placard text to show instead of the
	// editor. When set, every other field is inert.
	readonly placard: string | null;
	// Rung 1's automatic decision (before the user override is applied): whether
	// the preview would fit in at most half the canvas interior.
	readonly previewAutoShow: boolean;
	// Rung 2: force the strips view into focus mode.
	readonly forceFocus: boolean;
	// Rung 3: fold the edit box to one hint row.
	readonly foldPlayback: boolean;
	// A short status hint for an active content-aware rung (the forced focus),
	// or '' when none applies.
	readonly focusHint: string;
}

// Whether the preview pane is actually shown: the manual override wins in both
// directions (force-visible when auto-hidden, force-hidden when auto-shown);
// with no override the automatic rung decides.
export function previewVisible(
	autoShow: boolean,
	override: boolean | null,
): boolean {
	return override ?? autoShow;
}

// Solve the whole ladder for one editor moment. Deterministic and side-effect
// free: the same inputs always yield the same decisions, so every rung and its
// reversal is asserted by calling this with two sizes.
export function solveDegradation(input: DegradationInput): DegradationLayout {
	// Hard floor: a live placard carrying the current size, nothing else.
	if (input.termW < FLOOR_W || input.termH < FLOOR_H) {
		return {
			placard: `sprite editor needs ≥${FLOOR_W}×${FLOOR_H} — now ${input.termW}×${input.termH}`,
			previewAutoShow: false,
			forceFocus: false,
			foldPlayback: false,
			focusHint: '',
		};
	}

	// The canvas interior: the region right of the rail, above the chrome.
	const canvasW = input.termW - RAIL_W;
	const viewH = input.termH - CHROME_ROWS;

	// --- Rung 1: preview auto-hide ---
	// The float docks top-right at its native size, clamped to the interior.
	// "Covers more than half the canvas interior" is read per-axis: the docked
	// pane occupies a fixed width/height slab, so it covers more than half when
	// either the slab's width exceeds half the interior width or its height
	// exceeds half the interior height. (Pure area never crosses half above the
	// floor — the pane is small next to the whole interior — so the width axis is
	// what actually drives this rung as the terminal narrows toward the floor.)
	const paneW = Math.min(PREVIEW_W, canvasW);
	const paneH = Math.min(PREVIEW_H, viewH);
	const coversMoreThanHalf = paneW * 2 > canvasW || paneH * 2 > viewH;
	const previewAutoShow = !coversMoreThanHalf;

	// --- Rung 2: strips force focus when fewer than two full Frames fit ---
	// A Frame of w cells is 2w Pixels wide; each Pixel is `zoom` cells on screen.
	// Two of the widest Frame plus the inter-Frame gap must fit the interior.
	const frameScreenW = input.maxFrameCellW * 2 * input.zoom;
	const twoFramesFit = 2 * frameScreenW + FRAME_GAP <= canvasW;
	const forceFocus = input.frameCount >= 2 && !twoFramesFit;
	const focusHint = forceFocus
		? 'narrow terminal — strips folded to focus (grow width or zoom out)'
		: '';

	// --- Rung 3: fold the edit box when the rail can't fit it with the ink ---
	// The rail wants tools + the full ink list + the `edit` box. When they do
	// not all fit its height, the box folds to one hint row (the ink
	// list keeps windowing beyond that); the rail itself never hides (rung 4).
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
