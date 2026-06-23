// Hitstop (ADR 0017 §13c): a render-only freeze on a meaty hit. For a few dozen
// milliseconds the playfield holds its last drawn frame, so a Poise break lands with
// a punch — but the SIM NEVER PAUSES. Offline the sim advances in index.ts's frame
// callback while the playfield (the only thing this gates) skips its redraw;
// networked, snapshots keep arriving and interpolation keeps buffering. The frozen
// frame just isn't repainted until the timer drains. View-only and deterministic;
// the server has no concept of it.

// Default freeze on a poise-break. Short — long enough to read as a hit-pause, brief
// enough not to feel like a stutter (~4 frames at 60fps). A heavier future hit can
// pass a longer duration.
export const HITSTOP_MS = 70;

export interface Hitstop {
	remainingMs: number;
}

export const NO_HITSTOP: Hitstop = { remainingMs: 0 };

// Whether the view is currently frozen (a redraw should be skipped). Pure.
export function isFrozen(h: Hitstop): boolean {
	return h.remainingMs > 0;
}

// Begin (or extend) a freeze — the longer of the current and requested durations
// wins, so a second break mid-freeze can't shorten it. Pure.
export function triggerHitstop(h: Hitstop, ms: number = HITSTOP_MS): Hitstop {
	return { remainingMs: Math.max(h.remainingMs, ms) };
}

// Drain the freeze by one frame of wall time, clamped at zero. Pure; `dtMs` is the
// real elapsed time even though the rendered view is frozen, so the freeze lasts a
// fixed duration regardless of framerate.
export function stepHitstop(h: Hitstop, dtMs: number): Hitstop {
	return { remainingMs: Math.max(0, h.remainingMs - Math.max(0, dtMs)) };
}
