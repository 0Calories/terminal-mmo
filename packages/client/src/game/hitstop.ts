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

export function stepHitstop(h: Hitstop, dtMs: number): Hitstop {
	return { remainingMs: Math.max(0, h.remainingMs - Math.max(0, dtMs)) };
}
