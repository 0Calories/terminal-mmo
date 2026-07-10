// Hitstop is render pacing, not a visual (ADR 0013 amendment): the frame
// loop holds the last drawn frame for a beat on a meaty hit. The sim never
// pauses — only the redraw is gated, so positions catch up the instant the
// freeze drains.

export const HITSTOP_MS = 70;

export interface Hitstop {
	remainingMs: number;
}

export const NO_HITSTOP: Hitstop = { remainingMs: 0 };

export function isFrozen(h: Hitstop): boolean {
	return h.remainingMs > 0;
}

export function triggerHitstop(h: Hitstop, ms: number = HITSTOP_MS): Hitstop {
	return { remainingMs: Math.max(h.remainingMs, ms) };
}

// dtMs is real wall time even while the view is frozen.
export function stepHitstop(h: Hitstop, dtMs: number): Hitstop {
	return { remainingMs: Math.max(0, h.remainingMs - Math.max(0, dtMs)) };
}
