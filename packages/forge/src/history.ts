// Undo/redo for the Zone editor (#98): a past/present/future model. Two behaviours
// beyond the textbook model:
//  · Gesture coalescing — a drag stroke fires many edits but must undo in ONE step.
//    `record` merges into the current step when `tag` matches the step that produced
//    the present; a different or absent tag begins a new step. Each stroke gets a
//    unique tag; single-key edits pass none, so they never coalesce.
//  · Depth cap — `past` is bounded at HISTORY_CAP; the oldest entries fall off.

/** Max retained undo steps. Beyond this the oldest edits are forgotten. */
export const HISTORY_CAP = 200;

export interface History<T> {
	/** Prior states, oldest first; the top is the most recent undo target. */
	past: T[];
	present: T;
	/** Undone states, in redo order (index 0 = the next redo). */
	future: T[];
	/** Coalesce tag of the edit that produced `present` (null = uncoalescable). */
	tag: string | null;
}

export function initHistory<T>(present: T): History<T> {
	return { past: [], present, future: [], tag: null };
}

export function canUndo<T>(h: History<T>): boolean {
	return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
	return h.future.length > 0;
}

/** Record a new state. A `tag` matching the current step coalesces into it (the drag
 *  grows one undo entry); otherwise a fresh step is opened, `past` capped and the redo
 *  `future` cleared. */
export function record<T>(h: History<T>, next: T, tag?: string): History<T> {
	if (tag != null && tag === h.tag) {
		// Same gesture: replace the present in place, keep `past` as-is. A new edit
		// still invalidates any redo branch.
		return { past: h.past, present: next, future: [], tag };
	}
	const past = [...h.past, h.present];
	if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
	return { past, present: next, future: [], tag: tag ?? null };
}

export function undo<T>(h: History<T>): History<T> {
	if (h.past.length === 0) return h;
	const past = h.past.slice();
	const prev = past.pop() as T;
	// Reset the tag so a later same-tagged stroke can't merge across the undo.
	return { past, present: prev, future: [h.present, ...h.future], tag: null };
}

export function redo<T>(h: History<T>): History<T> {
	if (h.future.length === 0) return h;
	const future = h.future.slice();
	const next = future.shift() as T;
	return { past: [...h.past, h.present], present: next, future, tag: null };
}
