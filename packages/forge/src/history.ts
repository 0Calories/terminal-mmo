export const HISTORY_CAP = 200;

export interface History<T> {
	past: T[];
	present: T;
	future: T[];
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

export function record<T>(h: History<T>, next: T, tag?: string): History<T> {
	if (tag != null && tag === h.tag) {
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
