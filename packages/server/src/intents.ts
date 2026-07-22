import type { AvatarIntent } from '@mmo/core/zones';

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
