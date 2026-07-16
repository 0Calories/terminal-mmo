// Cosmetics request handling: the server's business, not the world
// simulation's (ADR 0032). A look change is only honoured in a Town.
import type { Cosmetics } from '@mmo/core/entities';
import {
	type ServerWorld,
	updateAvatar,
	withCosmetics,
	zoneStateOf,
} from '@mmo/core/world';

export function applyCosmetics(
	world: ServerWorld,
	sessionId: number,
	cosmetics: Cosmetics,
): { world: ServerWorld; changed: boolean } {
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined) return { world, changed: false };
	if (zs.zone.type !== 'town') return { world, changed: false };
	const sa = zs.avatars.find((a) => a.sessionId === sessionId);
	if (sa === undefined) return { world, changed: false };
	const next = updateAvatar(world, sessionId, (a) =>
		withCosmetics(a, cosmetics),
	);
	return { world: next, changed: true };
}
