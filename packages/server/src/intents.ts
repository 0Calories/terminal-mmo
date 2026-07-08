import type { AvatarIntent } from '@mmo/shared';

/**
 * Fold this tick's one-shot edges — body emotes (ADR 0020 §9) and interact/Portal (ADR 0027)
 * — onto each session's reused intent and consume them, so each fires exactly once. Edge, not
 * sticky flag: a flag left on the reused intent would re-fire every tick, or be missed when
 * the 20 Hz tick fails to sample the ~33 ms it sat on the wire. MUTATES the pending collections.
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
