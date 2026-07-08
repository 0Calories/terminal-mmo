// Hitstop (ADR 0017 §13c): a render-only freeze on a meaty hit — the playfield holds
// its last frame for a few dozen ms so a Poise break reads as a punch. The SIM NEVER
// PAUSES; snapshots and interpolation keep running, only the redraw is gated.

// Short enough not to read as a stutter, long enough to feel a hit-pause (~4 frames at 60fps).
export const HITSTOP_MS = 70;

export interface Hitstop {
	remainingMs: number;
}

export const NO_HITSTOP: Hitstop = { remainingMs: 0 };

export function isFrozen(h: Hitstop): boolean {
	return h.remainingMs > 0;
}

// The longer of current and requested wins, so a second break mid-freeze can't shorten it.
export function triggerHitstop(h: Hitstop, ms: number = HITSTOP_MS): Hitstop {
	return { remainingMs: Math.max(h.remainingMs, ms) };
}

// `dtMs` is real wall time even though the view is frozen, so the freeze lasts a fixed
// duration regardless of framerate.
export function stepHitstop(h: Hitstop, dtMs: number): Hitstop {
	return { remainingMs: Math.max(0, h.remainingMs - Math.max(0, dtMs)) };
}
