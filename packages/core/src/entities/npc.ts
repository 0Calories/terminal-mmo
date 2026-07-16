// Npc — a static, named placement in a Zone (today: the vendor). Deliberately
// NOT an Entity: an Npc is never fought and never stepped (CONTEXT.md — "NPCs
// are never fought"), so it carries no combat or physics fields; the type
// system says so by giving it only a footprint and an identity.

import type { Box } from './types';

export interface Npc extends Box {
	id: number;
	kind: 'vendor';
	name: string;
}
