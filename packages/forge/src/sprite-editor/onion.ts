// Pure onion-skin sourcing (spec #387, simplified round 3). Onion skinning is a
// plain on/off toggle now: when on, the focus view's active Frame ghosts the
// PREVIOUS Frame (wrap-aware — the first Frame ghosts the last) beneath its art,
// visible only through transparency. WHICH Frame ghosts is pure; rendering the
// ghost is the TUI's job. This module never reads a Pixel or touches a screen.
import type { RGBAQuad } from '@mmo/core/entities';

// The previous Frame tints red (kept as a param so `ghostColor` reads
// self-documenting; only 'prev' is used now).
export type OnionTint = 'prev' | 'next';

// The Frame to ghost under `active`: its immediate predecessor, wrapping so the
// first Frame ghosts the last. Null when there is no neighbour to ghost (a
// single-Frame Animation) or `active` is not in the list.
export function previousGhostFrame(
	frames: readonly string[],
	active: string,
): string | null {
	const n = frames.length;
	const i = frames.indexOf(active);
	if (n <= 1 || i < 0) return null;
	return frames[(i - 1 + n) % n];
}

// The RGB a ghost Pixel paints: its tint blended over the canvas background, so it
// reads as "behind" the art. Pure — the tint/blend math is unit-testable.
const GHOST_MAX_ALPHA = 0.72;
const PREV_TINT: readonly [number, number, number] = [214, 74, 74];
const NEXT_TINT: readonly [number, number, number] = [74, 118, 224];

export function ghostColor(
	tint: OnionTint,
	intensity: number,
	bg: RGBAQuad,
): RGBAQuad {
	const [tr, tg, tb] = tint === 'prev' ? PREV_TINT : NEXT_TINT;
	const a = Math.max(0, Math.min(1, intensity)) * GHOST_MAX_ALPHA;
	const mix = (c: number, t: number): number => Math.round(c + (t - c) * a);
	return [mix(bg[0], tr), mix(bg[1], tg), mix(bg[2], tb), 255];
}
