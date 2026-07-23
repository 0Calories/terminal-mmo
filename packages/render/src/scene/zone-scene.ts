import type { Entity, Npc, Terrain } from '@mmo/core/entities';
import type { Portal } from '@mmo/core/zones';

/** A drawable bundle of one zone's static contents, composed by consumers through
 *  the scene and sprite passes (ADR 0038). */
export interface ZoneScene {
	terrain: Terrain;
	portals: readonly Portal[];
	npcs: readonly Npc[];
	entities: readonly Entity[];
}
