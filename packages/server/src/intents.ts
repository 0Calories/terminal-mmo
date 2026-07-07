import type { AvatarIntent } from '@mmo/shared';

/**
 * Fold this tick's one-shot edges onto each session's reused intent and consume them,
 * so each fires exactly once: body emotes (ADR 0020 §9) and the interact/Portal edge
 * (ADR 0027). Both are "edge, not sticky flag" — a flag left on the reused intent would
 * re-fire every tick (or be missed when the 20 Hz tick fails to sample the ~33 ms it sat
 * on the wire). MUTATES the pending collections, draining whatever it folds.
 *
 * Pure of any server I/O so the coalescing is unit-testable apart from `Bun.serve`.
 */
export function foldPendingEdges(
	intents: Iterable<AvatarIntent>,
	pendingEmotes: Map<number, string>,
	pendingInteract: Set<number>,
): AvatarIntent[] {
	return [...intents].map((i) => {
		const em = pendingEmotes.get(i.sessionId);
		const interact = pendingInteract.delete(i.sessionId);
		if (em !== undefined) pendingEmotes.delete(i.sessionId);
		if (em === undefined && !interact) return i;
		return { ...i, ...(em !== undefined ? { emote: em } : {}), interact };
	});
}
