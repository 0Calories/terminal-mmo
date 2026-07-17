// Pure onion-skin sourcing (spec #387). Onion skinning ghosts neighbouring
// Frames under the active Frame so in-between drawing has visible motion
// context: previous Frames tint red, next Frames blue, intensity falling with
// distance, wrapping within the Animation. WHICH Frames ghost — at which tint and
// intensity — is pure: a function of the Animation's Frame list, the active Frame,
// and the onion depth. Rendering the ghosts (under the current art, visible only
// through transparency, replacing the checkerboard there) is the TUI's job; this
// module never reads a Pixel or touches a screen.
import type { RGBAQuad } from '@mmo/core/entities';

// Onion depth cycles 0 → 1 → 2 → 0 (spec #387, `O`): 0 = off (the default),
// N = ghost N Frames each way.
export const ONION_MAX_DEPTH = 2;

// The next depth on the cycle (wraps 2 → 0).
export function cycleOnionDepth(depth: number): number {
	return (depth + 1) % (ONION_MAX_DEPTH + 1);
}

// A previous Frame tints red, a next Frame blue.
export type OnionTint = 'prev' | 'next';

export interface OnionGhost {
	// The Frame to ghost under the active one.
	readonly frame: string;
	readonly tint: OnionTint;
	// Falls with distance from the active Frame: nearest neighbour 1, farthest
	// 1/depth. Always in (0, 1].
	readonly intensity: number;
}

// The ghosts to draw under `active`, NEAREST FIRST — so a renderer that lets the
// first lit ghost win a Pixel gets "nearest wins", and at equal distance the
// previous (red) ghost, listed first, beats the next (blue) one.
//
// Yields nothing when onion skin is off (depth ≤ 0), an Animation has one Frame or
// none (there is no neighbour to ghost), or `active` is not in the list. Indices
// wrap within the Animation; a ghost index that resolves back to the active Frame is
// dropped — under its own transparent Pixels it would contribute nothing.
export function onionGhosts(
	frames: readonly string[],
	active: string,
	depth: number,
): OnionGhost[] {
	const n = frames.length;
	const activeIdx = frames.indexOf(active);
	if (depth <= 0 || n <= 1 || activeIdx < 0) return [];
	const at = (i: number): string => frames[((i % n) + n) % n];
	const ghosts: OnionGhost[] = [];
	for (let k = 1; k <= depth; k++) {
		const intensity = (depth - k + 1) / depth;
		const prev = at(activeIdx - k);
		const next = at(activeIdx + k);
		if (prev !== active) ghosts.push({ frame: prev, tint: 'prev', intensity });
		if (next !== active) ghosts.push({ frame: next, tint: 'next', intensity });
	}
	return ghosts;
}

// The RGB a ghost Pixel paints: its tint blended over the canvas background by
// intensity, so a farther ghost fades toward the canvas and reads as "further
// behind". Pure — the tint/blend math is unit-testable without a screen.
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
